import { afterEach, describe, expect, it, vi } from "vitest";
import { memoizeAsync } from "@/lib/server/cache/memoize-async";

describe("memoizeAsync", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reuses the result until the TTL runs out", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const load = vi.fn(async () => load.mock.calls.length);
    const read = memoizeAsync(load, 10_000);

    expect(await read()).toBe(1);
    now.mockReturnValue(10_999);
    expect(await read()).toBe(1);
    now.mockReturnValue(11_000);
    expect(await read()).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("lets concurrent callers share one call in flight", async () => {
    let finish: (value: string) => void = () => {};
    const load = vi.fn(() => new Promise<string>((resolve) => (finish = resolve)));
    const read = memoizeAsync(load, 10_000);

    const results = Promise.all([read(), read(), read()]);
    finish("probe");

    expect(await results).toEqual(["probe", "probe", "probe"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failure", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("probe failed"))
      .mockResolvedValueOnce("probe");
    const read = memoizeAsync(load, 10_000);

    await expect(read()).rejects.toThrow("probe failed");
    expect(await read()).toBe("probe");
  });
});
