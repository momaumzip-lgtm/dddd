export default function QuietGarden() {
  return (
    <svg viewBox="0 0 360 280" fill="none" aria-hidden="true" className="quiet-garden">
      <defs>
        <linearGradient
          id="garden-light"
          x1="96"
          y1="30"
          x2="268"
          y2="257"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#dce6d5" />
          <stop offset="1" stopColor="#edf1e8" />
        </linearGradient>
        <linearGradient
          id="garden-leaf"
          x1="195"
          y1="105"
          x2="236"
          y2="201"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#729279" />
          <stop offset="1" stopColor="#335e49" />
        </linearGradient>
        <clipPath id="garden-arch">
          <path d="M89 240V110a91 91 0 0 1 182 0v130Z" />
        </clipPath>
      </defs>
      <ellipse cx="187" cy="254" rx="128" ry="10" fill="#234c3b" opacity=".045" />
      <path d="M80 240V110a100 100 0 0 1 200 0v130" stroke="#bacbb7" strokeWidth="1" />
      <path d="M89 240V110a91 91 0 0 1 182 0v130Z" fill="url(#garden-light)" />
      <g clipPath="url(#garden-arch)">
        <circle cx="213" cy="73" r="27" fill="#fafbf5" />
        <path d="M62 194c56-64 111-56 163-21 30 20 52 23 81 15v80H62Z" fill="#c0d0b6" />
        <path d="M52 222c64-43 103-27 155-10 47 16 74 10 97-7v52H52Z" fill="#a6bfa1" />
        <path d="M180 15v224M89 121h182" stroke="#f7f9f2" strokeWidth="5" />
        <path d="m193 131 70 109h-38l-39-109Z" fill="#f8faf3" opacity=".38" />
      </g>
      <path d="M64 241h235" stroke="#a9bba3" strokeLinecap="round" />
      <path
        d="M222 218c-2-46 5-80 27-116M227 173c-18-10-26-20-30-39M234 145c10-12 23-16 37-15"
        stroke="#496e51"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M242 123c-5-28 10-49 32-49 5 24-8 43-32 49Z" fill="url(#garden-leaf)" />
      <path d="M229 174c-29-1-46-19-43-44 28 0 46 17 43 44Z" fill="#6d8c68" />
      <path d="M233 153c4-25 21-35 43-30-1 23-18 36-43 30Z" fill="#92ac80" />
      <path d="m217 208 1 24c0 14 26 15 28 0l2-24Z" fill="#f7f8f0" stroke="#bdcbb4" />
      <ellipse cx="232" cy="208" rx="15" ry="4" fill="#d7dfcd" stroke="#bdcbb4" />
      <path d="M123 224c0-13 8-20 19-20s19 7 19 20v17h-38Z" fill="#edf1e5" />
      <path d="M130 240v-16c0-9 4-14 12-14" stroke="#c4d1ba" />
      <path d="m98 64 4 4m-4 0 4-4" stroke="#a6b99d" strokeLinecap="round" />
      <circle cx="301" cy="171" r="2" fill="#a6b99d" />
    </svg>
  );
}
