/**
 * File-type brand icons — official language marks shared by the admin
 * Files browser and the admin Git panel, so both surfaces render the exact
 * same file identity instead of drifting out of sync with two copies.
 *
 * Brand path data mirrors simple-icons (single 24x24 path per mark) with
 * each language's official brand color. Markdown and JSON are monochrome
 * marks upstream, so they render in `currentColor` and inherit the row
 * tint — visible on every theme. Everything else keeps its Lucide
 * fallback exactly as before.
 */

/* eslint-disable react-refresh/only-export-components -- shared file-mark module: FileTypeIcon component plus its fileTypeStyle resolver, consumed together by Files and Git */

import type { ComponentType, SVGProps } from 'react'
import {
  FileText,
  FileCode2,
  FileTerminal,
  FileArchive,
  FileImage,
  FileType2,
  Hash,
} from 'lucide-react'
import { cn } from '@/utils/cn.util'

// ── Official brand path data (24x24) ─────────────────────────────────────────

const TS_D =
  'M1.125 0C.502 0 0 .502 0 1.125v21.75C0 23.498.502 24 1.125 24h21.75c.623 0 1.125-.502 1.125-1.125V1.125C24 .502 23.498 0 22.875 0zm17.363 9.75c.612 0 1.154.037 1.627.111a6.38 6.38 0 0 1 1.306.34v2.458a3.95 3.95 0 0 0-.643-.361 5.093 5.093 0 0 0-.717-.26 5.453 5.453 0 0 0-1.426-.2c-.3 0-.573.028-.819.086a2.1 2.1 0 0 0-.623.242c-.17.104-.3.229-.393.374a.888.888 0 0 0-.14.49c0 .196.053.373.156.529.104.156.252.304.443.444s.423.276.696.41c.273.135.582.274.926.416.47.197.892.407 1.266.628.374.222.695.473.963.753.268.279.472.598.614.957.142.359.214.776.214 1.253 0 .657-.125 1.21-.373 1.656a3.033 3.033 0 0 1-1.012 1.085 4.38 4.38 0 0 1-1.487.596c-.566.12-1.163.18-1.79.18a9.916 9.916 0 0 1-1.84-.164 5.544 5.544 0 0 1-1.512-.493v-2.63a5.033 5.033 0 0 0 3.237 1.2c.333 0 .624-.03.872-.09.249-.06.456-.144.623-.25.166-.108.29-.234.373-.38a1.023 1.023 0 0 0-.074-1.089 2.12 2.12 0 0 0-.537-.5 5.597 5.597 0 0 0-.807-.444 27.72 27.72 0 0 0-1.007-.436c-.918-.383-1.602-.852-2.053-1.405-.45-.553-.676-1.222-.676-2.005 0-.614.123-1.141.369-1.582.246-.441.58-.804 1.004-1.089a4.494 4.494 0 0 1 1.47-.629 7.536 7.536 0 0 1 1.77-.201zm-15.113.188h9.563v2.166H9.506v9.646H6.789v-9.646H3.375z'

const JS_D =
  'M0 0h24v24H0V0zm22.034 18.276c-.175-1.095-.888-2.015-3.003-2.873-.736-.345-1.554-.585-1.797-1.14-.091-.33-.105-.51-.046-.705.15-.646.915-.84 1.515-.66.39.12.75.42.976.9 1.034-.676 1.034-.676 1.755-1.125-.27-.42-.404-.601-.586-.78-.63-.705-1.469-1.065-2.834-1.034l-.705.089c-.676.165-1.32.525-1.71 1.005-1.14 1.291-.811 3.541.569 4.471 1.365 1.02 3.361 1.244 3.616 2.205.24 1.17-.87 1.545-1.966 1.41-.811-.18-1.26-.586-1.755-1.336l-1.83 1.051c.21.48.45.689.81 1.109 1.74 1.756 6.09 1.666 6.871-1.004.029-.09.24-.705.074-1.65l.046.067zm-8.983-7.245h-2.248c0 1.938-.009 3.864-.009 5.805 0 1.232.063 2.363-.138 2.711-.33.689-1.18.601-1.566.48-.396-.196-.597-.466-.83-.855-.063-.105-.11-.196-.127-.196l-1.825 1.125c.305.63.75 1.172 1.324 1.517.855.51 2.004.675 3.207.405.783-.226 1.458-.691 1.811-1.411.51-.93.402-2.07.397-3.346.012-2.054 0-4.109 0-6.179l.004-.056z'

const HTML_D =
  'M1.5 0h21l-1.91 21.563L11.977 24l-8.564-2.438L1.5 0zm7.031 9.75l-.232-2.718 10.059.003.23-2.622L5.412 4.41l.698 8.01h9.126l-.326 3.426-2.91.804-2.955-.81-.188-2.11H6.248l.33 4.171L12 19.351l5.379-1.443.744-8.157H8.531z'

const CSS_D =
  'M0 0v20.16A3.84 3.84 0 0 0 3.84 24h16.32A3.84 3.84 0 0 0 24 20.16V3.84A3.84 3.84 0 0 0 20.16 0Zm14.256 13.08c1.56 0 2.28 1.08 2.304 2.64h-1.608c.024-.288-.048-.6-.144-.84-.096-.192-.288-.264-.552-.264-.456 0-.696.264-.696.84-.024.576.288.888.768 1.08.72.288 1.608.744 1.92 1.296q.432.648.432 1.656c0 1.608-.912 2.592-2.496 2.592-1.656 0-2.4-1.032-2.424-2.688h1.68c0 .792.264 1.176.792 1.176.264 0 .456-.072.552-.24.192-.312.24-1.176-.048-1.512-.312-.408-.912-.6-1.32-.816q-.828-.396-1.224-.936c-.24-.36-.36-.888-.36-1.536 0-1.44.936-2.472 2.424-2.448m5.4 0c1.584 0 2.304 1.08 2.328 2.64h-1.608c0-.288-.048-.6-.168-.84-.096-.192-.264-.264-.528-.264-.48 0-.72.264-.72.84s.288.888.792 1.08c.696.288 1.608.744 1.92 1.296.264.432.408.984.408 1.656.024 1.608-.888 2.592-2.472 2.592-1.68 0-2.424-1.056-2.448-2.688h1.68c0 .744.264 1.176.792 1.176.264 0 .456-.072.552-.24.216-.312.264-1.176-.048-1.512-.288-.408-.888-.6-1.32-.816-.552-.264-.96-.576-1.2-.936s-.36-.888-.36-1.536c-.024-1.44.912-2.472 2.4-2.448m-11.031.018c.711-.006 1.419.198 1.839.63.432.432.672 1.128.648 1.992H9.336c.024-.456-.096-.792-.432-.96-.312-.144-.768-.048-.888.24-.12.264-.192.576-.168.864v3.504c0 .744.264 1.128.768 1.128a.65.65 0 0 0 .552-.264c.168-.24.192-.552.168-.84h1.776c.096 1.632-.984 2.712-2.568 2.688-1.536 0-2.496-.864-2.472-2.472v-4.032c0-.816.24-1.44.696-1.848.432-.408 1.146-.624 1.857-.63'

const MD_D =
  'M22.27 19.385H1.73A1.73 1.73 0 010 17.655V6.345a1.73 1.73 0 011.73-1.73h20.54A1.73 1.73 0 0124 6.345v11.308a1.73 1.73 0 01-1.73 1.731zM5.769 15.923v-4.5l2.308 2.885 2.307-2.885v4.5h2.308V8.078h-2.308l-2.307 2.885-2.308-2.885H3.46v7.847zM21.232 12h-2.309V8.077h-2.307V12h-2.308l3.461 4.039z'

const PY_D =
  'M14.25.18l.9.2.73.26.59.3.45.32.34.34.25.34.16.33.1.3.04.26.02.2-.01.13V8.5l-.05.63-.13.55-.21.46-.26.38-.3.31-.33.25-.35.19-.35.14-.33.1-.3.07-.26.04-.21.02H8.77l-.69.05-.59.14-.5.22-.41.27-.33.32-.27.35-.2.36-.15.37-.1.35-.07.32-.04.27-.02.21v3.06H3.17l-.21-.03-.28-.07-.32-.12-.35-.18-.36-.26-.36-.36-.35-.46-.32-.59-.28-.73-.21-.88-.14-1.05-.05-1.23.06-1.22.16-1.04.24-.87.32-.71.36-.57.4-.44.42-.33.42-.24.4-.16.36-.1.32-.05.24-.01h.16l.06.01h8.16v-.83H6.18l-.01-2.75-.02-.37.05-.34.11-.31.17-.28.25-.26.31-.23.38-.2.44-.18.51-.15.58-.12.64-.1.71-.06.77-.04.84-.02 1.27.05zm-6.3 1.98l-.23.33-.08.41.08.41.23.34.33.22.41.09.41-.09.33-.22.23-.34.08-.41-.08-.41-.23-.33-.33-.22-.41-.09-.41.09zm13.09 3.95l.28.06.32.12.35.18.36.27.36.35.35.47.32.59.28.73.21.88.14 1.04.05 1.23-.06 1.23-.16 1.04-.24.86-.32.71-.36.57-.4.45-.42.33-.42.24-.4.16-.36.09-.32.05-.24.02-.16-.01h-8.22v.82h5.84l.01 2.76.02.36-.05.34-.11.31-.17.29-.25.25-.31.24-.38.2-.44.17-.51.15-.58.13-.64.09-.71.07-.77.04-.84.01-1.27-.04-1.07-.14-.9-.2-.73-.25-.59-.3-.45-.33-.34-.34-.25-.34-.16-.33-.1-.3-.04-.25-.02-.2.01-.13v-5.34l.05-.64.13-.54.21-.46.26-.38.3-.32.33-.24.35-.2.35-.14.33-.1.3-.06.26-.04.21-.02.13-.01h5.84l.69-.05.59-.14.5-.21.41-.28.33-.32.27-.35.2-.36.15-.36.1-.35.07-.32.04-.28.02-.21V6.07h2.09l.14.01zm-6.47 14.25l-.23.33-.08.41.08.41.23.33.33.23.41.08.41-.08.33-.23.23-.33.08-.41-.08-.41-.23-.33-.33-.23-.41-.08-.41.08z'

const NPM_D =
  'M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z'

const BASH_D =
  'M21.038,4.9l-7.577-4.498C13.009,0,.134,12.505,0,12,0c-0.505,0-1.009,0,.134-1.462,0.403L2.961,4.9 C2.057,5.437,1.5,6.429,1.5,7.503v8.995c0,1.073,0.557,2.066,1.462,2.603l7.577,4.497C10.991,23.866,11.495,24,12,24 c0.505,0,1.009-0.134,1.461-0.402l7.577-4.497c0.904-0.537,1.462-1.529,1.462-2.603V7.503C22.5,6.429,21.943,5.437,21.038,4.9z M15.17,18.946l0.013,0.646c0.001,0,.078-0.05,0.167-0.111,0.198l-0.383,0.22c-0.061,0.031-0.111-0.007-0.112-0.085L14.57,19.29 c-0.328,0.136-0.66,0.169-0.872,0.084c-0.04-0.016-0.057-0.075-0.041-0.142l0.139-0.584c0.011-0.046,0.036-0.092,0.069-0.121 c0.012-0.011,0.024-0.02,0.036-0.026c0.022-0.011,0.043-0.014,0.062-0.006c0.229,0.077,0.521,0.041,0.802-0.101 c0.357-0.181,0.596-0.545,0.592-0.907c-0.003-0.328-0.181-0.465-0.613-0.468c-0.55,0.001-1.064-0.107-1.072-0.917 c-0.007-0.667,0.34-1.361,0.889-1.8l-0.007-0.652c-0.001-0.08,0.048-0.168,0.111-0.2l0.37-0.236 c0.061-0.031,0.111,0.007,0.112,0.087l0.006,0.653c0.273-0.109,0.511-0.138,0.726-0.088c0.047,0.012,0.067,0.076,0.048,0.151 l-0.144,0.578c-0.011,0.044-0.036,0.088-0.065,0.116c-0.012,0.012-0.025,0.021-0.038,0.028c-0.019,0.01-0.038,0.013-0.057,0.009 c-0.098-0.022-0.332-0.073-0.699,0.113c-0.385,0.195-0.52,0.53-0.517,0.778c0.003,0.297,0.155,0.387,0.681,0.396 c0.7,0.012,1.003,0.318,1.01,1.023C16.105,17.747,15.736,18.491,15.17,18.946z M19.143,17.859c0,0.06-0.008,0.116-0.058,0.145 l-1.916,1.164c-0.05,0.029-0.09,0.004-0.09-0.056v-0.494c0-0.06,0.037-0.093,0.087-0.122l1.887-1.129 c0.05-0.029,0.09-0.004,0.09,0.056V17.859z M20.459,6.797l-7.168,4.427c-0.894,0.523-1.553,1.109-1.553,2.187v8.833 c0,0.645,0.26,1.063,0.66,1.184c-0.131,0.023-0.264,0.039-0.398,0.039c-0.42,0-0.833-0.114-1.197-0.33L3.226,18.64 c-0.741-0.44-1.201-1.261-1.201-2.142V7.503c0-0.881,0.46-1.702,1.201-2.142l7.577-4.498c0.363-0.216,0.777-0.33,1.197-0.33 c0.419,0,0.833,0.114,1.197,0.33l7.577,4.498c0.624,0.371,1.046,1.013,1.164,1.732C21.686,6.557,21.12,6.411,20.459,6.797z'

const REACT_D =
  'M14.23 12.004a2.236 2.236 0 0 1-2.235 2.236 2.236 2.236 0 0 1-2.236-2.236 2.236 2.236 0 0 1 2.235-2.236 2.236 2.236 0 0 1 2.236 2.236zm2.648-10.69c-1.346 0-3.107.96-4.888 2.622-1.78-1.653-3.542-2.602-4.887-2.602-.41 0-.783.093-1.106.278-1.375.793-1.683 3.264-.973 6.365C1.98 8.917 0 10.42 0 12.004c0 1.59 1.99 3.097 5.043 4.03-.704 3.113-.39 5.588.988 6.38.32.187.69.275 1.102.275 1.345 0 3.107-.96 4.888-2.624 1.78 1.654 3.542 2.603 4.887 2.603.41 0 .783-.09 1.106-.275 1.374-.792 1.683-3.263.973-6.365C22.02 15.096 24 13.59 24 12.004c0-1.59-1.99-3.097-5.043-4.032.704-3.11.39-5.587-.988-6.38-.318-.184-.688-.277-1.092-.278zm-.005 1.09v.006c.225 0 .406.044.558.127.666.382.955 1.835.73 3.704-.054.46-.142.945-.25 1.44-.96-.236-2.006-.417-3.107-.534-.66-.905-1.345-1.727-2.035-2.447 1.592-1.48 3.087-2.292 4.105-2.295zm-9.77.02c1.012 0 2.514.808 4.11 2.28-.686.72-1.37 1.537-2.02 2.442-1.107.117-2.154.298-3.113.538-.112-.49-.195-.964-.254-1.42-.23-1.868.054-3.32.714-3.707.19-.09.4-.127.563-.132zm4.882 3.05c.455.468.91.992 1.36 1.564-.44-.02-.89-.034-1.345-.034-.46 0-.915.01-1.36.034.44-.572.895-1.096 1.345-1.565zM12 8.1c.74 0 1.477.034 2.202.093.406.582.802 1.203 1.183 1.86.372.64.71 1.29 1.018 1.946-.308.655-.646 1.31-1.013 1.95-.38.66-.773 1.288-1.18 1.87-.728.063-1.466.098-2.21.098-.74 0-1.477-.035-2.202-.093-.406-.582-.802-1.204-1.183-1.86-.372-.64-.71-1.29-1.018-1.946.303-.657.646-1.313 1.013-1.954.38-.66.773-1.286 1.18-1.868.728-.064 1.466-.098 2.21-.098zm-3.635.254c-.24.377-.48.763-.704 1.16-.225.39-.435.782-.635 1.174-.265-.656-.49-1.31-.676-1.947.64-.15 1.315-.283 2.015-.386zm7.26 0c.695.103 1.365.23 2.006.387-.18.632-.405 1.282-.66 1.933-.2-.39-.41-.783-.64-1.174-.225-.392-.465-.774-.705-1.146zm3.063.675c.484.15.944.317 1.375.498 1.732.74 2.852 1.708 2.852 2.476-.005.768-1.125 1.74-2.857 2.475-.42.18-.88.342-1.355.493-.28-.958-.646-1.956-1.1-2.98.45-1.017.81-2.01 1.085-2.964zm-13.395.004c.278.96.645 1.957 1.1 2.98-.45 1.017-.812 2.01-1.086 2.964-.484-.15-.944-.318-1.37-.5-1.732-.737-2.852-1.706-2.852-2.474 0-.768 1.12-1.742 2.852-2.476.42-.18.88-.342 1.356-.494zm11.678 4.28c.265.657.49 1.312.676 1.948-.64.157-1.316.29-2.016.39.24-.375.48-.762.705-1.158.225-.39.435-.788.636-1.18zm-9.945.02c.2.392.41.783.64 1.175.23.39.465.772.705 1.143-.695-.102-1.365-.23-2.006-.386.18-.63.406-1.282.66-1.933zM17.92 16.32c.112.493.2.968.254 1.423.23 1.868-.054 3.32-.714 3.708-.147.09-.338.128-.563.128-1.012 0-2.514-.807-4.11-2.28.686-.72 1.37-1.536 2.02-2.44 1.107-.118 2.154-.3 3.113-.54zm-11.83.01c.96.234 2.006.415 3.107.532.66.905 1.345 1.727 2.035 2.446-1.595 1.483-3.092 2.295-4.11 2.295-.22-.005-.406-.05-.553-.132-.666-.38-.955-1.834-.73-3.703.054-.46.142-.944.25-1.438zm4.56.64c.44.02.89.034 1.345.034.46 0 .915-.01 1.36-.034-.44.572-.895 1.095-1.345 1.565-.455-.47-.91-.993-1.36-1.565z'

const GIT_D =
  'M23.546 10.93L13.067.452c-.604-.603-1.582-.603-2.188 0L8.708 2.627l2.76 2.76c.645-.215 1.379-.07 1.889.441.516.515.658 1.258.438 1.9l2.658 2.66c.645-.223 1.387-.078 1.9.435.721.72.721 1.884 0 2.604-.719.719-1.881.719-2.6 0-.539-.541-.674-1.337-.404-1.996L12.86 8.955v6.525c.176.086.342.203.488.348.713.721.713 1.883 0 2.6-.719.721-1.889.721-2.609 0-.719-.719-.719-1.879 0-2.598.182-.18.387-.316.605-.406V8.835c-.217-.091-.424-.222-.6-.401-.545-.545-.676-1.342-.396-2.009L7.636 3.7.45 10.881c-.6.605-.6 1.584 0 2.189l10.48 10.477c.604.604 1.582.604 2.186 0l10.43-10.43c.605-.603.605-1.582 0-2.187'

const JSON_D =
  'M12.043 23.968c.479-.004.953-.029 1.426-.094a11.805 11.805 0 003.146-.863 12.404 12.404 0 003.793-2.542 11.977 11.977 0 002.44-3.427 11.794 11.794 0 001.02-3.476c.149-1.16.135-2.346-.045-3.499a11.96 11.96 0 00-.793-2.788 11.197 11.197 0 00-.854-1.617c-1.168-1.837-2.861-3.314-4.81-4.3a12.835 12.835 0 00-2.172-.87h-.005c.119.063.24.132.345.201.12.074.239.146.351.225a8.93 8.93 0 011.559 1.33c1.063 1.145 1.797 2.548 2.218 4.041.284.982.434 1.998.495 3.017.044.743.044 1.491-.047 2.229-.149 1.27-.554 2.51-1.228 3.596a7.475 7.475 0 01-1.903 2.084c-1.244.928-2.877 1.482-4.436 1.114a3.916 3.916 0 01-.748-.258 4.692 4.692 0 01-.779-.45 6.08 6.08 0 01-1.244-1.105 6.507 6.507 0 01-1.049-1.747 7.366 7.366 0 01-.494-2.54c-.03-1.273.225-2.553.854-3.67a6.43 6.43 0 011.663-1.918c.225-.178.464-.333.704-.479l.016-.007a5.121 5.121 0 00-1.441-.12 4.963 4.963 0 00-1.228.24c-.359.12-.704.27-1.019.45a6.146 6.146 0 00-.733.494c-.211.18-.42.36-.615.555-1.123 1.153-1.768 2.682-2.022 4.256-.15.973-.15 1.96-.091 2.95.105 1.395.391 2.787.945 4.062a8.518 8.518 0 001.348 2.173 8.14 8.14 0 003.132 2.23 7.934 7.934 0 002.113.54c.074.015.149.015.209.015zm-2.934-.398a4.102 4.102 0 01-.45-.228 8.5 8.5 0 01-2.038-1.534c-1.094-1.137-1.827-2.566-2.247-4.08a15.184 15.184 0 01-.495-3.172 12.14 12.14 0 01.046-2.082c.135-1.257.495-2.501 1.124-3.58a6.889 6.889 0 011.783-2.053 6.23 6.23 0 011.633-.9 5.363 5.363 0 013.522-.045c.029 0 .029 0 .045.03.015.015.045.015.06.03.045.016.104.045.165.074.239.12.479.271.704.42a6.294 6.294 0 012.097 2.502c.42.914.615 1.934.631 2.938.014 1.079-.18 2.157-.645 3.146a6.42 6.42 0 01-2.638 2.832c.09.03.18.045.271.075.225.044.449.074.688.074 1.468.045 2.892-.66 3.94-1.647.195-.18.375-.375.54-.585.225-.27.435-.54.614-.823.239-.375.435-.75.614-1.154a8.112 8.112 0 00.509-1.664c.196-1.004.211-2.022.149-3.026-.135-2.022-.673-4.045-1.842-5.724a9.054 9.054 0 00-.555-.719 9.868 9.868 0 00-1.063-1.034 8.477 8.477 0 00-1.363-.915 9.927 9.927 0 00-1.692-.598l-.3-.06c-.209-.03-.42-.044-.634-.06a8.453 8.453 0 00-1.015.016c-.704.045-1.412.16-2.112.337C5.799 1.227 2.863 3.566 1.3 6.67A11.834 11.834 0 00.238 9.801a11.81 11.81 0 00-.104 3.775c.12 1.02.374 2.023.778 2.977.227.57.511 1.124.825 1.648 1.094 1.783 2.683 3.236 4.51 4.24.688.39 1.408.69 2.157.944.226.074.45.15.689.21z'

// ── Brand mark factory ───────────────────────────────────────────────────────

type BrandProps = { className?: string }

function brandMark(d: string, fill: string) {
  return function BrandMark({ className }: BrandProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        fill={fill}
        aria-hidden="true"
      >
        <path d={d} />
      </svg>
    )
  }
}

// Official brand colors; Markdown and JSON are monochrome upstream so they
// inherit the row tint (visible on every theme).
const TypeScriptIcon = brandMark(TS_D, '#3178C6')
const JavaScriptIcon = brandMark(JS_D, '#F7DF1E')
const HtmlIcon = brandMark(HTML_D, '#E34F26')
const CssIcon = brandMark(CSS_D, '#663399')
const MarkdownIcon = brandMark(MD_D, 'currentColor')
const PythonIcon = brandMark(PY_D, '#3776AB')
const BashIcon = brandMark(BASH_D, '#4EAA25')
const NpmIcon = brandMark(NPM_D, '#CB3837')
const JsonIcon = brandMark(JSON_D, 'currentColor')
const ReactIcon = brandMark(REACT_D, '#61DAFB')
const GitIcon = brandMark(GIT_D, '#F05032')

/** SQL files get a database-cylinder mark (no single official SVG exists). */
function SqlIcon({ className }: BrandProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="#4D8DC4"
      aria-hidden="true"
    >
      <path d="M12 3C7.03 3 3 4.9 3 7.25v9.5C3 19.1 7.03 21 12 21s9-1.9 9-4.25v-9.5C21 4.9 16.97 3 12 3zm0 2c4.3 0 7 1.4 7 2.25S16.3 9.5 12 9.5 5 8.1 5 7.25 7.7 5 12 5zm-7 4.54c1.94.7 4.39 1.21 7 1.21s5.06-.51 7-1.21v3.21c0 .85-2.7 2.25-7 2.25s-7-1.4-7-2.25V9.54zm0 5c1.94.7 4.39 1.21 7 1.21s5.06-.51 7-1.21v1.71c0 .85-2.7 2.25-7 2.25s-7-1.4-7-2.25v-1.71z" />
    </svg>
  )
}

// ── Extension → mark + tint ──────────────────────────────────────────────────

type FileMark = {
  icon: ComponentType<SVGProps<SVGSVGElement>>
  className: string
}

const FILE_TYPE_MAP: Record<string, FileMark> = {
  ts: { icon: TypeScriptIcon, className: 'text-primary' },
  tsx: { icon: ReactIcon, className: 'text-primary' },
  mts: { icon: TypeScriptIcon, className: 'text-primary' },
  cts: { icon: TypeScriptIcon, className: 'text-primary' },
  js: { icon: JavaScriptIcon, className: 'text-warning' },
  jsx: { icon: ReactIcon, className: 'text-warning' },
  mjs: { icon: JavaScriptIcon, className: 'text-warning' },
  cjs: { icon: JavaScriptIcon, className: 'text-warning' },
  json: { icon: JsonIcon, className: 'text-warning' },
  md: { icon: MarkdownIcon, className: 'text-info' },
  mdx: { icon: MarkdownIcon, className: 'text-info' },
  markdown: { icon: MarkdownIcon, className: 'text-info' },
  css: { icon: CssIcon, className: 'text-info' },
  scss: { icon: CssIcon, className: 'text-info' },
  sass: { icon: CssIcon, className: 'text-info' },
  less: { icon: CssIcon, className: 'text-info' },
  html: { icon: HtmlIcon, className: 'text-tertiary' },
  htm: { icon: HtmlIcon, className: 'text-tertiary' },
  xml: { icon: HtmlIcon, className: 'text-tertiary' },
  vue: { icon: FileCode2, className: 'text-success' },
  svelte: { icon: FileCode2, className: 'text-tertiary' },
  sql: { icon: SqlIcon, className: 'text-info' },
  py: { icon: PythonIcon, className: 'text-success' },
  pyw: { icon: PythonIcon, className: 'text-success' },
  sh: { icon: BashIcon, className: 'text-success' },
  bash: { icon: BashIcon, className: 'text-success' },
  zsh: { icon: BashIcon, className: 'text-success' },
  fish: { icon: BashIcon, className: 'text-success' },
  yml: { icon: Hash, className: 'text-tertiary' },
  yaml: { icon: Hash, className: 'text-tertiary' },
  toml: { icon: Hash, className: 'text-tertiary' },
  ini: { icon: Hash, className: 'text-tertiary' },
  env: { icon: FileType2, className: 'text-secondary' },
  lock: { icon: FileArchive, className: 'text-secondary' },
  go: { icon: FileCode2, className: 'text-info' },
  rs: { icon: FileCode2, className: 'text-tertiary' },
  java: { icon: FileCode2, className: 'text-tertiary' },
  php: { icon: FileCode2, className: 'text-primary' },
  rb: { icon: FileCode2, className: 'text-error' },
  c: { icon: FileCode2, className: 'text-info' },
  h: { icon: FileCode2, className: 'text-info' },
  hpp: { icon: FileCode2, className: 'text-info' },
  cpp: { icon: FileCode2, className: 'text-info' },
  cc: { icon: FileCode2, className: 'text-info' },
  cs: { icon: FileCode2, className: 'text-success' },
  swift: { icon: FileCode2, className: 'text-tertiary' },
  kt: { icon: FileCode2, className: 'text-tertiary' },
  txt: { icon: FileText, className: 'text-on-surface-variant/70' },
  svg: { icon: FileImage, className: 'text-warning' },
  png: { icon: FileImage, className: 'text-warning' },
  jpg: { icon: FileImage, className: 'text-warning' },
  jpeg: { icon: FileImage, className: 'text-warning' },
  gif: { icon: FileImage, className: 'text-warning' },
  ico: { icon: FileImage, className: 'text-warning' },
  webp: { icon: FileImage, className: 'text-warning' },
  avif: { icon: FileImage, className: 'text-warning' },
  mp4: { icon: FileImage, className: 'text-warning' },
  webm: { icon: FileImage, className: 'text-warning' },
  mp3: { icon: FileTerminal, className: 'text-warning' },
  wav: { icon: FileTerminal, className: 'text-warning' },
  ogg: { icon: FileTerminal, className: 'text-warning' },
  zip: { icon: FileArchive, className: 'text-secondary' },
  gz: { icon: FileArchive, className: 'text-secondary' },
  tar: { icon: FileArchive, className: 'text-secondary' },
  gitignore: { icon: GitIcon, className: 'text-tertiary' },
  gitattributes: { icon: GitIcon, className: 'text-tertiary' },
  gitmodules: { icon: GitIcon, className: 'text-tertiary' },
  dockerignore: { icon: Hash, className: 'text-tertiary' },
}

const NPM_FILES = new Set([
  'package.json',
  'package-lock.json',
  '.npmrc',
  'pnpm-lock.yaml',
  'yarn.lock',
])

const fallback: FileMark = {
  icon: FileText,
  className: 'text-on-surface-variant/70',
}

/** Returns the typed mark + tint for a file path (defaults to neutral). */
export function fileTypeStyle(name: string): FileMark {
  const lower = name.toLowerCase()
  const base = lower.split('/').pop() ?? lower
  if (NPM_FILES.has(base)) {
    return { icon: NpmIcon, className: '' }
  }
  // Dotfiles (.env.development, .gitignore): match the stem first so the
  // leading dot doesn't masquerade as the extension separator.
  const stem = base.startsWith('.') ? base.slice(1) : base
  if (stem === 'env' || stem.startsWith('env.')) {
    return { icon: FileType2, className: 'text-secondary' }
  }
  const ext = stem.includes('.') ? (stem.split('.').pop() ?? '') : stem
  return (ext !== '' && FILE_TYPE_MAP[ext]) || fallback
}

/** Renders the typed mark for a filename with its tint applied. */
export function FileTypeIcon({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  const { icon: Icon, className: tint } = fileTypeStyle(name)
  return <Icon className={cn(tint, className)} />
}

// ── Shared language detection (editor highlighting) ──────────────────────────

/** Extension → syntax-highlighter language key. */
const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  jsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',
  css: 'css',
  scss: 'css',
  less: 'css',
  sass: 'css',
  html: 'html',
  htm: 'html',
  xml: 'html',
  svg: 'html',
  vue: 'html',
  svelte: 'html',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  py: 'python',
  pyw: 'python',
  sql: 'sql',
  toml: 'ini',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  gitignore: 'ini',
  gitattributes: 'ini',
  gitmodules: 'ini',
  txt: 'text',
  text: 'text',
  env: 'ini',
}

/**
 * Language key driving editor highlighting, resolved with the same
 * dotfile/filename rules as the file icons so both surfaces always agree.
 * Returns null for plain text / unknown types.
 */
export function getFileLanguage(name: string): string | null {
  const lower = name.toLowerCase()
  const base = lower.split('/').pop() ?? lower
  if (NPM_FILES.has(base)) return 'json'
  const stem = base.startsWith('.') ? base.slice(1) : base
  if (stem === 'env' || stem.startsWith('env.')) return 'ini'
  const ext = stem.includes('.') ? (stem.split('.').pop() ?? '') : stem
  if (ext === '') return null
  return LANGUAGE_MAP[ext] ?? null
}
