/** Minimal stroke icon set (24px viewBox, currentColor). */

import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  )
}

export const IconWave = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12h2M7 6v12M11 3v18M15 7v10M19 10v4M21 12h0" />
  </Svg>
)

export const IconSliders = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
    <path d="M1 14h6M9 8h6M17 16h6" />
  </Svg>
)

export const IconScript = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 2H7a2 2 0 0 0-2 2v13" />
    <path d="M12 22h5a2 2 0 0 0 2-2V8l-6-6" />
    <path d="M5 17a2.5 2.5 0 0 1 0 5h11" />
    <path d="M9 7h5M9 11h5" />
  </Svg>
)

export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 10l5 5 5-5" />
    <path d="M12 15V3" />
  </Svg>
)

export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </Svg>
)

export const IconPlay = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 4l13 8-13 8V4z" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconChip = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="5" width="14" height="14" rx="2" />
    <rect x="9" y="9" width="6" height="6" />
    <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
  </Svg>
)

export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10.3 3.8 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4M12 17h0" />
  </Svg>
)

export const IconRefresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 12a9 9 0 1 1-2.6-6.4" />
    <path d="M21 3v6h-6" />
  </Svg>
)

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </Svg>
)

export const IconSpinner = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3a9 9 0 1 0 9 9" />
  </Svg>
)

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
)

export const IconArrowRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
)

export const IconX = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
)

export const IconFolder = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-8l-2-3H4a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1z" />
  </Svg>
)

export const IconPause = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
    <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconServer = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="3" width="20" height="8" rx="2" />
    <rect x="2" y="13" width="20" height="8" rx="2" />
    <path d="M6 7h0M6 17h0" />
  </Svg>
)

export const IconBook = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    <path d="M9 7h7M9 11h7" />
  </Svg>
)

export const IconKey = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7.5" cy="15.5" r="4.5" />
    <path d="M10.7 12.3 21 2M18 5l2.5 2.5M14.5 8.5l2.5 2.5" />
  </Svg>
)

export const IconCopy = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Svg>
)
