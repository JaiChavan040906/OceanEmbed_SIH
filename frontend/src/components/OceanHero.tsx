/**
 * Stylized ocean-current world map used behind the landing hero.
 * Inline SVG so it themes with CSS and needs no external asset.
 * The forms are impressionistic — flowing strokes suggest gyres and currents,
 * with the Indian Ocean (our region of interest) rendered slightly denser.
 */
export default function OceanHero() {
  return (
    <div className="ocean-hero" aria-hidden>
      <svg viewBox="0 0 1600 900" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="oh-water" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#c9d8e6" stopOpacity="0.55" />
            <stop offset="45%" stopColor="#5f89ad" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#1f3a55" stopOpacity="0.7" />
          </linearGradient>
          <linearGradient id="oh-current" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#0a1e33" stopOpacity="0" />
            <stop offset="50%" stopColor="#0a1e33" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#0a1e33" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="oh-glow" cx="72%" cy="52%" r="45%">
            <stop offset="0%" stopColor="#2a5578" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#2a5578" stopOpacity="0" />
          </radialGradient>
          <pattern id="oh-grid" width="80" height="80" patternUnits="userSpaceOnUse">
            <path d="M 80 0 L 0 0 0 80" fill="none" stroke="#0a1e33" strokeOpacity="0.06" strokeWidth="1" />
          </pattern>
        </defs>

        {/* Base wash — the "water" */}
        <rect width="1600" height="900" fill="url(#oh-water)" opacity="0.35" />
        <rect width="1600" height="900" fill="url(#oh-glow)" />
        <rect width="1600" height="900" fill="url(#oh-grid)" />

        {/* Continents — chalky off-white silhouettes */}
        <g fill="#f4f2ec" stroke="#0a1e33" strokeWidth="0.6" strokeOpacity="0.35">
          {/* Africa */}
          <path d="M760,300 C790,290 830,300 860,330 C900,365 900,420 890,470 C880,530 855,580 830,610 C815,630 790,635 775,620 C760,600 755,560 760,520 C740,510 725,485 730,455 C725,420 735,380 740,350 Z" />
          {/* Europe rough */}
          <path d="M720,220 C755,215 810,220 855,235 C880,245 895,255 890,275 C860,285 800,285 760,280 C735,275 715,250 720,220 Z" />
          {/* Asia — big block for Eurasia's east */}
          <path d="M900,215 C990,210 1120,220 1230,240 C1290,255 1340,275 1360,305 C1350,335 1310,355 1250,360 C1160,365 1050,355 970,335 C920,320 895,290 895,255 Z" />
          {/* India peninsula */}
          <path d="M1030,340 C1060,345 1080,360 1085,390 C1088,415 1075,435 1055,440 C1035,445 1020,420 1020,395 C1020,375 1020,355 1030,340 Z" />
          {/* Southeast Asia + Indonesia (scattered) */}
          <path d="M1180,420 C1215,415 1250,425 1265,445 C1265,465 1235,475 1210,472 C1188,470 1170,455 1180,420 Z" />
          <ellipse cx="1245" cy="490" rx="30" ry="10" />
          <ellipse cx="1300" cy="510" rx="24" ry="8" />
          {/* Australia */}
          <path d="M1280,600 C1330,590 1400,595 1430,615 C1445,635 1425,660 1385,670 C1340,675 1290,668 1275,650 C1265,635 1265,615 1280,600 Z" />
          {/* North America */}
          <path d="M230,220 C310,205 420,215 480,245 C500,275 495,305 470,320 C420,335 340,335 285,325 C250,315 220,285 230,220 Z" />
          <path d="M350,340 C400,345 445,365 445,395 C440,420 420,435 390,430 C365,425 345,405 350,340 Z" />
          {/* South America */}
          <path d="M450,470 C495,465 540,485 555,530 C570,585 555,650 525,700 C500,735 470,745 455,720 C435,680 425,610 435,555 C440,520 445,495 450,470 Z" />
          {/* Antarctica sliver */}
          <path d="M100,830 L1500,830 L1500,880 L100,880 Z" opacity="0.6" />
        </g>

        {/* Ocean currents — sweeping strokes */}
        <g fill="none" stroke="url(#oh-current)" strokeWidth="1.4" strokeLinecap="round" opacity="0.9">
          {/* Global loops */}
          <path d="M60,180 C280,150 520,180 760,220 C980,255 1200,260 1420,235 C1500,225 1560,215 1580,205" />
          <path d="M40,300 C220,280 460,310 700,345 C920,375 1180,380 1400,360 C1500,352 1560,340 1580,325" />
          <path d="M40,430 C240,420 480,455 720,485 C960,515 1200,520 1420,500 C1500,492 1560,480 1580,465" />
          <path d="M40,555 C220,555 460,585 700,615 C920,640 1180,640 1400,620 C1500,610 1560,600 1580,585" />
          <path d="M40,680 C220,680 460,705 700,730 C920,755 1180,755 1400,735 C1500,725 1560,715 1580,700" />
          {/* Denser Indian-Ocean gyre (our region) */}
          <path d="M900,380 C960,360 1050,360 1110,390 C1160,425 1170,470 1130,500 C1080,525 1010,520 970,495 C925,470 900,435 900,380 Z" opacity="0.6" />
          <path d="M880,415 C955,395 1050,395 1120,425 C1170,460 1175,505 1130,530 C1080,555 1000,548 960,520 C915,495 880,470 880,415 Z" opacity="0.35" />
        </g>

        {/* Faint graticule ticks */}
        <g fill="#0a1e33" fillOpacity="0.4" fontSize="11" fontFamily="ui-monospace, monospace">
          <text x="1560" y="220">60°N</text>
          <text x="1560" y="360">30°N</text>
          <text x="1560" y="475">0°</text>
          <text x="1560" y="590">30°S</text>
          <text x="1560" y="720">60°S</text>
        </g>
      </svg>
    </div>
  );
}
