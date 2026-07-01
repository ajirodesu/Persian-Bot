import type { SVGProps } from 'react'

/**
 * Cat-Bot brand mark — fluffy cat face glyph.
 *
 * Drop-in replacement for the previous lucide `Cat` icon used as the
 * site logo. Mirrors the lucide-react icon API (`className`, standard SVG
 * props) and inherits colour via `currentColor`, so existing usages such
 * as `<Logo className={H_LOGO_ICON} />` inside a `text-primary` wrapper
 * continue to theme automatically — no hard-coded colour values.
 */
export default function Logo({
  className,
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="-28 -28 568 413"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M 52,14 L 45,32 L 45,64 L 50,91 L 57,110 L 19,134 L 51,139 L 35,154 L 15,180 L 5,201 L 0,223 L 18,206 L 29,201 L 13,260 L 11,292 L 17,313 L 26,326 L 43,339 L 30,314 L 28,287 L 38,255 L 39,261 L 41,261 L 40,264 L 56,290 L 71,306 L 90,320 L 128,338 L 188,353 L 229,357 L 301,356 L 343,350 L 384,339 L 420,322 L 446,302 L 465,278 L 475,256 L 484,279 L 485,303 L 481,319 L 468,338 L 478,333 L 492,318 L 501,297 L 502,274 L 498,250 L 484,201 L 486,200 L 512,220 L 507,199 L 495,175 L 482,158 L 462,139 L 465,137 L 486,136 L 493,133 L 486,131 L 457,111 L 466,78 L 468,36 L 465,23 L 454,8 L 431,0 L 403,1 L 372,9 L 345,22 L 292,10 L 233,9 L 198,14 L 168,23 L 138,8 L 101,0 L 80,0 L 67,3 Z M 73,27 L 78,23 L 93,22 L 116,28 L 134,37 L 160,57 L 201,41 L 249,34 L 280,35 L 305,39 L 354,56 L 369,43 L 393,29 L 421,22 L 438,25 L 444,35 L 444,58 L 438,86 L 433,96 L 401,77 L 398,73 L 422,65 L 421,62 L 402,56 L 390,56 L 364,64 L 364,66 L 389,83 L 420,115 L 435,136 L 450,165 L 458,193 L 459,214 L 455,236 L 444,260 L 423,284 L 404,298 L 385,308 L 340,322 L 299,328 L 241,330 L 187,325 L 140,313 L 110,299 L 93,287 L 77,271 L 62,247 L 55,222 L 56,188 L 67,155 L 93,113 L 120,85 L 150,64 L 124,56 L 111,56 L 89,64 L 115,74 L 81,97 L 77,90 L 70,60 L 69,38 Z"
      />
      <path
        fill="currentColor"
        d="M 326,172 L 322,174 L 317,179 L 315,183 L 314,198 L 317,205 L 322,210 L 327,212 L 336,212 L 340,210 L 347,202 L 349,192 L 348,185 L 344,177 L 337,172 Z"
      />
      <path
        fill="currentColor"
        d="M 176,172 L 171,175 L 166,182 L 165,185 L 165,198 L 169,206 L 172,209 L 178,212 L 187,212 L 194,208 L 198,203 L 200,195 L 200,188 L 197,180 L 192,174 L 187,172 Z"
      />
      <path
        fill="currentColor"
        d="M 232,209 L 230,213 L 231,223 L 239,232 L 248,237 L 249,240 L 246,245 L 237,252 L 230,255 L 217,257 L 214,260 L 214,265 L 217,268 L 234,268 L 250,259 L 256,252 L 259,256 L 270,264 L 282,269 L 295,269 L 301,265 L 301,260 L 299,258 L 278,253 L 273,250 L 265,241 L 265,238 L 275,231 L 283,221 L 284,215 L 279,207 L 271,204 L 241,204 Z"
      />
    </svg>
  )
}
