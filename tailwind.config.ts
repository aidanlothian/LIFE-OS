import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Light "notebook page" theme: warm off-white/grey base with a
        // soft mustard-yellow accent, standing in for a highlighter pen.
        bg: "#f2efe6",
        panel: "#faf8f2",
        border: "#ded6c3",
        text: "#3a352c",
        muted: "#8c8372",
        accent: "#c9971f",
        good: "#5f8a5f",
        warn: "#c1642a",
        bad: "#b0503f",
      },
    },
  },
  plugins: [],
};
export default config;
