jest.mock("../../../utils/websocket", () => ({ sendCommandToFigma: jest.fn() }));
import { normalizeParams, remapRefs } from "../batch-tools";

describe("batch normalizeParams", () => {
  it("converts hex colors for known color keys", () => {
    const out = normalizeParams({ fillColor: "#ff0000", fontColor: "#00000080", name: "#notcolor" })!;
    expect(out.fillColor).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect((out.fontColor as { a: number }).a).toBeCloseTo(128 / 255);
    expect(out.name).toBe("#notcolor");
  });
  it("leaves RGBA objects alone", () => {
    const c = { r: 0, g: 0, b: 0, a: 0 };
    expect(normalizeParams({ fillColor: c })!.fillColor).toBe(c);
  });
});

describe("batch remapRefs", () => {
  const ids = new Map<number, string>([[0, "1:10"], [3, "1:13"]]);
  it("replaces refs to earlier chunks with ids", () => {
    expect(remapRefs({ parentId: "$3" }, 100, ids)).toEqual({ parentId: "1:13" });
  });
  it("re-indexes refs inside the current chunk", () => {
    expect(remapRefs({ parentId: "$105", nested: ["$100"] }, 100, ids)).toEqual({ parentId: "$5", nested: ["$0"] });
  });
  it("leaves non-ref strings", () => {
    expect(remapRefs({ text: "$5 off", name: "$" }, 0, ids)).toEqual({ text: "$5 off", name: "$" });
  });
  it("throws for a ref to an earlier op without id", () => {
    expect(() => remapRefs({ parentId: "$1" }, 100, ids)).toThrow(/\$1/);
  });
});
