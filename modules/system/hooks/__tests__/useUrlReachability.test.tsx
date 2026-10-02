/* @vitest-environment jsdom */

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUrlReachability } from "@/modules/system/hooks/useUrlReachability";

describe("useUrlReachability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts null, then reports true once the probe resolves", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));

    const { result } = renderHook(() => useUrlReachability("http://127.0.0.1:3095"));
    expect(result.current).toBeNull();

    await waitFor(() => expect(result.current).toBe(true));
  });

  it("reports false when the probe fails at the network level", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    const { result } = renderHook(() => useUrlReachability("http://127.0.0.1:3095"));

    await waitFor(() => expect(result.current).toBe(false));
  });

  it("stays null and never probes when the url is null", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const { result } = renderHook(() => useUrlReachability(null));

    expect(result.current).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("re-probes when the url changes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));

    const { result, rerender } = renderHook(({ url }) => useUrlReachability(url), {
      initialProps: { url: "http://a.example:3095" as string | null },
    });

    await waitFor(() => expect(result.current).toBe(true));
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    rerender({ url: "http://b.example:3095" });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
  });
});
