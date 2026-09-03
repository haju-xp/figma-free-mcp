import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import { logger } from "./logger";
import { serverUrl, defaultPort, WS_URL, reconnectInterval } from "../config/config";
import { FigmaCommand, FigmaResponse, CommandProgressUpdate, PendingRequest, ProgressMessage } from "../types";
import { invalidateAll as invalidateNodeCache } from "./node-cache";

// WebSocket connection and request tracking
let ws: WebSocket | null = null;
let currentChannel: string | null = null;

// Channels this single ws has joined — enables routing commands to multiple files
const joinedChannels = new Set<string>();

// Map of pending requests for promise tracking
const pendingRequests = new Map<string, PendingRequest>();

/**
 * Connects to the Figma server via WebSocket.
 * @param port - Optional port for the connection (defaults to defaultPort from config)
 */
export function connectToFigma(port: number = defaultPort) {
  // If already connected, do nothing
  if (ws && ws.readyState === WebSocket.OPEN) {
    logger.info('Already connected to Figma');
    return;
  }

  // If connection is in progress (CONNECTING state), wait
  if (ws && ws.readyState === WebSocket.CONNECTING) {
    logger.info('Connection to Figma is already in progress');
    return;
  }

  // If there's an existing socket in a closing state, clean it up
  if (ws && (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED)) {
    ws.removeAllListeners();
    ws = null;
  }

  const wsUrl = serverUrl === 'localhost' ? `${WS_URL}:${port}` : WS_URL;
  logger.info(`Connecting to Figma socket server at ${wsUrl}...`);
  
  try {
    ws = new WebSocket(wsUrl);
    
    // Add connection timeout
    const connectionTimeout = setTimeout(() => {
      if (ws && ws.readyState === WebSocket.CONNECTING) {
        logger.error('Connection to Figma timed out');
        ws.terminate();
      }
    }, 10000); // 10 second connection timeout
    
    ws.on('open', () => {
      clearTimeout(connectionTimeout);
      logger.info('Connected to Figma socket server');
      // Reset channel on new connection
      currentChannel = null;
    });

    ws.on("message", (data: any) => {
      try {
        const json = JSON.parse(data) as ProgressMessage;

        // Handle progress updates
        if (json.type === 'progress_update') {
          const progressData = json.message.data as CommandProgressUpdate;
          const requestId = json.id || '';

          if (requestId && pendingRequests.has(requestId)) {
            const request = pendingRequests.get(requestId)!;

            // Update last activity timestamp
            request.lastActivity = Date.now();

            // Reset the timeout to prevent timeouts during long-running operations
            clearTimeout(request.timeout);

            // Create a new timeout with extended time for long operations
            request.timeout = setTimeout(() => {
              if (pendingRequests.has(requestId)) {
                logger.error(`Request ${requestId} timed out after extended period of inactivity`);
                pendingRequests.delete(requestId);
                request.reject(new Error('Request to Figma timed out'));
              }
            }, 120000); // 120 second timeout for inactivity during progress updates

            // Log progress
            logger.info(`Progress update for ${progressData.commandType}: ${progressData.progress}% - ${progressData.message}`);

            // For completed updates, we could resolve the request early if desired
            if (progressData.status === 'completed' && progressData.progress === 100) {
              // Optionally resolve early with partial data
              // request.resolve(progressData.payload);
              // pendingRequests.delete(requestId);

              // Instead, just log the completion, wait for final result from Figma
              logger.info(`Operation ${progressData.commandType} completed, waiting for final result`);
            }
          }
          return;
        }

        // Handle regular responses
        const myResponse = json.message;
        logger.debug(`Received message: ${JSON.stringify(myResponse)}`);

        // Skip command echoes (own messages broadcast back to sender)
        if (myResponse.command) {
          return;
        }

        // Handle response to a request (success or error)
        if (
          myResponse.id &&
          pendingRequests.has(myResponse.id)
        ) {
          const request = pendingRequests.get(myResponse.id)!;

          // Reject replies arriving on a different channel than the command targeted
          if (request.expectedChannel && json.channel && json.channel !== request.expectedChannel) {
            return;
          }

          clearTimeout(request.timeout);

          // Check for error at root level or nested inside result
          const error = myResponse.error ?? (myResponse.result && myResponse.result.error);

          if (error) {
            logger.error(`Error from Figma: ${error}`);
            request.reject(new Error(String(error)));
          } else {
            request.resolve(myResponse.result ?? myResponse);
          }

          pendingRequests.delete(myResponse.id);
        } else {
          // Handle broadcast messages or events
          logger.info(`Received broadcast message: ${JSON.stringify(myResponse)}`);
        }
      } catch (error) {
        logger.error(`Error parsing message: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    ws.on('error', (error) => {
      logger.error(`Socket error: ${error}`);
      // Don't attempt to reconnect here, let the close handler do it
    });

    ws.on('close', (code, reason) => {
      clearTimeout(connectionTimeout);
      logger.info(`Disconnected from Figma socket server with code ${code} and reason: ${reason || 'No reason provided'}`);
      ws = null;

      // Reject all pending requests
      for (const [id, request] of pendingRequests.entries()) {
        clearTimeout(request.timeout);
        request.reject(new Error(`Connection closed with code ${code}: ${reason || 'No reason provided'}`));
        pendingRequests.delete(id);
      }

      // Attempt to reconnect with exponential backoff
      const backoff = Math.min(30000, reconnectInterval * Math.pow(1.5, Math.floor(Math.random() * 5))); // Max 30s
      logger.info(`Attempting to reconnect in ${backoff/1000} seconds...`);
      setTimeout(() => connectToFigma(port), backoff);
    });
    
  } catch (error) {
    logger.error(`Failed to create WebSocket connection: ${error instanceof Error ? error.message : String(error)}`);
    // Attempt to reconnect after a delay
    setTimeout(() => connectToFigma(port), reconnectInterval);
  }
}

/**
 * Join a specific channel in Figma.
 * @param channelName - Name of the channel to join
 * @returns Promise that resolves when successfully joined the channel
 */
export async function joinChannel(channelName: string): Promise<void> {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("Not connected to Figma");
  }

  try {
    await sendCommandToFigma("join", { channel: channelName });
    currentChannel = channelName;
    joinedChannels.add(channelName);

    try {
      await sendCommandToFigma("ping", {}, 12000);
      logger.info(`Joined channel: ${channelName}`);
    } catch (verificationError) {
      currentChannel = null;
      joinedChannels.delete(channelName);
      const errorMsg = verificationError instanceof Error
        ? verificationError.message
        : String(verificationError);
      logger.error(`Failed to verify channel ${channelName}: ${errorMsg}`);
      throw new Error(`Failed to verify connection to channel "${channelName}". The Figma plugin may not be connected to this channel.`);
    }
  } catch (error) {
    logger.error(`Failed to join channel: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Get the current channel the connection is joined to.
 * @returns The current channel name or null if not connected to any channel
 */
export function getCurrentChannel(): string | null {
  return currentChannel;
}

/**
 * 활성 채널 목록을 WebSocket 서버에서 조회
 * @param port - WebSocket 서버 포트
 * @returns 활성 채널 목록
 */
export interface ActiveChannel {
  channel: string;
  clients: number;
  fileKey?: string;
  fileName?: string;
  pageName?: string;
}

export async function getActiveChannels(port: number = defaultPort): Promise<ActiveChannel[]> {
  const url = `http://localhost:${port}/channels`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { channels: ActiveChannel[] };
    return data.channels || [];
  } catch (error) {
    logger.error(`Failed to fetch active channels: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * 자동 채널 연결 — 활성 채널이 1개면 자동 연결, 여러 개면 목록 반환
 * @returns 연결 결과 메시지
 */
export async function autoConnect(): Promise<string> {
  // 이미 연결되어 있으면 ping으로 실제 연결 확인
  if (currentChannel) {
    try {
      await sendCommandToFigma("ping", {}, 5000);
      return `Already connected to channel: ${currentChannel}`;
    } catch {
      // ping 실패 → 채널 리셋하고 재연결
      currentChannel = null;
    }
  }

  // WebSocket 서버에 연결 확인
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    connectToFigma();
    // 연결 대기
    await new Promise(resolve => setTimeout(resolve, 2000));
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return "WebSocket server not running. Start it with: npx figma-free-mcp-socket";
    }
  }

  // 활성 채널 조회
  const channels = await getActiveChannels();

  if (channels.length === 0) {
    return "No active Figma channels found. Open the 'Claude Talk to Figma' plugin in Figma first.";
  }

  if (channels.length === 1) {
    // 채널이 1개면 자동 연결
    const channel = channels[0];
    await joinChannel(channel.channel);
    return `Auto-connected to channel: ${channel.channel} (${channel.clients} client(s))`;
  }

  // 여러 채널이 있으면 목록 반환
  const list = channels.map((ch, i) => {
    const label = ch.fileName ? ` — ${ch.fileName}${ch.pageName ? ` / ${ch.pageName}` : ""}` : "";
    return `  ${i + 1}. ${ch.channel}${label} (${ch.clients} client(s))`;
  }).join("\n");
  return `Multiple channels found:\n${list}\n\nUse join_channel with the desired channel ID.`;
}

/**
 * Send a command to Figma via WebSocket.
 * @param command - The command to send
 * @param params - Additional parameters for the command
 * @param timeoutMs - Timeout in milliseconds before failing
 * @returns A promise that resolves with the Figma response
 */
/**
 * 노드 상태를 바꾸지 않는 커맨드 목록.
 *
 * 캐시 무효화를 쓰기 도구마다 개별로 호출하도록 두면 100개가 넘는 도구 중
 * 하나만 빠뜨려도 최대 TTL 동안 낡은 노드 정보가 반환된다. 모든 커맨드가
 * 반드시 통과하는 이 지점에서 한 번에 처리하는 편이 안전하다.
 * 여기에 없는 커맨드는 전부 쓰기로 간주한다(모르는 것은 쓰기 취급).
 */
const READ_ONLY_COMMANDS: ReadonlySet<string> = new Set([
  "ping",
  "join",
  "get_document_info",
  "get_selection",
  "get_node_info",
  "get_nodes_info",
  "get_styles",
  "get_local_components",
  "get_remote_components",
  "get_team_components",
  "get_styled_text_segments",
  "get_pages",
  "get_image_from_node",
  "get_svg",
  "get_grid",
  "get_guide",
  "get_annotation",
  "get_variables",
  "get_figjam_elements",
  "export_node_as_image",
  "scan_text_nodes",
]);

export function sendCommandToFigma(
  command: FigmaCommand,
  params: unknown = {},
  timeoutMs: number = 60000,
  target?: string
): Promise<unknown> {
  // 쓰기 커맨드는 전송 시점에 노드 캐시를 버린다. batch 는 내부에 어떤
  // 커맨드가 들어있든 쓰기로 취급된다(허용목록에 없으므로 자동).
  const isWrite = !READ_ONLY_COMMANDS.has(command);
  if (isWrite) {
    invalidateNodeCache();
  }

  return new Promise((resolve, reject) => {
    // If not connected, try to connect first
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connectToFigma();
      reject(new Error("Not connected to Figma. Attempting to connect..."));
      return;
    }

    // Resolve which channel this command targets (per-command override → default)
    const targetChannel = command === "join" ? (params as any).channel : (target ?? currentChannel);

    // Check if we need a channel for this command
    const requiresChannel = command !== "join";
    if (requiresChannel && !targetChannel) {
      reject(new Error("Must join a channel before sending commands"));
      return;
    }

    const id = uuidv4();
    const request = {
      id,
      type: command === "join" ? "join" : "message",
      channel: targetChannel,
      message: {
        id,
        command,
        params: {
          ...(params as any),
          commandId: id, // Include the command ID in params
        },
      },
    };

    // Set timeout for request
    const timeout = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        logger.error(`Request ${id} to Figma timed out after ${timeoutMs / 1000} seconds`);
        reject(new Error('Request to Figma timed out'));
      }
    }, timeoutMs);

    // Store the promise callbacks to resolve/reject later.
    // 쓰기 커맨드는 전송 시점과 완료 시점에 각각 캐시를 버린다. 전송 시점만
    // 버리면, 전송~완료 사이에 끝난 동시 조회가 변경 전 값을 다시 캐시에
    // 넣어버릴 수 있다(batch 처럼 오래 걸리는 커맨드에서 특히).
    pendingRequests.set(id, {
      resolve: isWrite
        ? (value: unknown) => {
            invalidateNodeCache();
            resolve(value);
          }
        : resolve,
      reject,
      timeout,
      lastActivity: Date.now(),
      expectedChannel: requiresChannel ? (targetChannel as string) : undefined,
    });

    // Send the request
    logger.info(`Sending command to Figma: ${command}${target ? ` (target: ${target})` : ""}`);
    logger.debug(`Request details: ${JSON.stringify(request)}`);
    ws.send(JSON.stringify(request));
  });
}
