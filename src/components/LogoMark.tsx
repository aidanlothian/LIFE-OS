// The Life OS mark: a brain whose right half holds the day's "3 Things"
// (two done, one to go). The same drawing is used for the browser icon
// and phone icons (src/app/icon.png, apple-icon.png), so change them together.
export default function LogoMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Life OS"
    >
      <path
        d="M48 22 C40 18 30 19 26 26 C18 27 14 35 17 42 C12 47 12 56 18 61 C16 69 21 76 29 77 C33 83 42 84 48 80 Z"
        fill="#3a352c"
      />
      <path
        d="M52 22 C60 18 70 19 74 26 C82 27 86 35 83 42 C88 47 88 56 82 61 C84 69 79 76 71 77 C67 83 58 84 52 80 Z"
        fill="#3a352c"
      />
      <path
        d="M30 34 C35 32 38 37 43 35 M22 50 C28 47 33 53 40 50 M28 66 C33 63 37 69 43 66"
        fill="none"
        stroke="#faf8f2"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx="66" cy="35" r="5.5" fill="#c9971f" />
      <circle cx="68" cy="51" r="5.5" fill="#c9971f" />
      <circle cx="65" cy="66" r="4.6" fill="none" stroke="#c9971f" strokeWidth="2.8" />
    </svg>
  );
}
