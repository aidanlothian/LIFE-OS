"use client";

import { useEffect, useState } from "react";

// True on a phone-width screen (below Tailwind's `sm`, 640px). For layouts
// that can't be switched with CSS alone, e.g. table column widths set in
// px. It's false on the server and for the first paint, then follows the
// window as it's resized or the phone is turned.
export function useNarrow(maxWidth = 639): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [maxWidth]);
  return narrow;
}
