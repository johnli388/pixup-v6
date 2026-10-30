import { useId } from 'react';
export function CardArt({
  variant = 'orbit',
  className = '',
  number = '001',
}: {
  variant?: string;
  className?: string;
  number?: string;
}) {
  const uid = useId().replaceAll(':', '');
  const sports = variant.startsWith('court'),
    pop = variant.startsWith('idol'),
    pixel = variant.startsWith('pixel');
  const alt = variant.endsWith('2'),
    color = sports
      ? alt
        ? '#cec8fd'
        : '#e5ecab'
      : pop
        ? alt
          ? '#ffc4a7'
          : '#ded0ff'
        : pixel
          ? alt
            ? '#b4e3a5'
            : '#bfdbe9'
          : alt
            ? '#b8e9ea'
            : '#e7c7e8';
  if (variant.startsWith('media:'))
    return (
      <div className={`card-art uploaded-art ${className}`}>
        <img
          src={`/api/media/${variant.slice(6)}`}
          alt="Uploaded collectible artwork"
          loading="lazy"
        />
      </div>
    );
  return (
    <div className={`card-art ${variant} ${className}`}>
      <svg
        viewBox="0 0 240 330"
        role="img"
        aria-label={`${sports ? 'Basketball' : pop ? 'Pop music' : pixel ? 'Gaming' : 'Abstract art'} original demonstration card`}
      >
        <defs>
          <linearGradient id={`bg-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor={color} />
            <stop
              offset="1"
              stopColor={sports ? '#91a266' : pop ? '#8f76b3' : pixel ? '#5b8290' : '#b677ab'}
            />
          </linearGradient>
          <linearGradient id={`foil-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#ffffff" stopOpacity=".5" />
            <stop offset=".5" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="1" stopColor="#ffffff" stopOpacity=".3" />
          </linearGradient>
        </defs>
        <rect width="240" height="330" rx="13" fill="#eff0e4" />
        <rect x="7" y="7" width="226" height="316" rx="8" fill={`url(#bg-${uid})`} />
        <rect
          x="16"
          y="16"
          width="208"
          height="298"
          rx="2"
          fill="none"
          stroke="#fff"
          opacity=".7"
        />
        <text x="24" y="34" fontSize="8" fontWeight="700" letterSpacing="3" fill="#263326">
          {sports ? 'COURT CULTURE' : pop ? 'AFTER HOURS' : pixel ? 'PIXEL WORLDS' : 'FUTURE FORMS'}
        </text>
        <text x="216" y="34" textAnchor="end" fontSize="7" fill="#263326">
          {number}
        </text>
        {sports ? (
          <>
            <circle cx="121" cy="139" r="88" fill="#f7f0d5" opacity=".5" />
            <path d="M27 245L212 64M30 280L219 96" stroke="#f1f1d3" strokeWidth="2" opacity=".6" />
            <text
              x="119"
              y="224"
              textAnchor="middle"
              fill="#f8f6e8"
              fontSize="136"
              fontWeight="900"
              opacity=".85"
            >
              23
            </text>
            <g fill="#202c2b">
              <circle cx="126" cy="104" r="15" />
              <path d="M111 121L139 122L151 177L122 188L100 168Z" />
              <path d="M113 128L91 151L69 117L59 125L88 169L116 149ZM136 127L160 103L171 70L181 74L174 117L145 148Z" />
              <path d="M108 168L131 177L109 222L89 257L74 253L93 212ZM131 175L149 171L166 208L151 254L135 251L145 210Z" />
            </g>
            <circle cx="180" cy="62" r="20" fill="#c0753d" stroke="#34412b" strokeWidth="2" />
            <path
              d="M160 62H200M180 42V82M167 47Q189 62 167 77"
              fill="none"
              stroke="#34412b"
              strokeWidth="1.5"
            />
            <text x="129" y="148" fill="#ecf0c4" fontSize="17" textAnchor="middle" fontWeight="800">
              23
            </text>
          </>
        ) : pop ? (
          <>
            <circle cx="120" cy="154" r="92" fill="#e8e0ff" opacity=".45" />
            <path
              d="M28 90Q119 14 216 119M32 221Q124 309 215 195"
              fill="none"
              stroke="#fff"
              opacity=".6"
            />
            <text
              x="120"
              y="122"
              textAnchor="middle"
              fontSize="67"
              fontWeight="800"
              letterSpacing="-5"
              fill="#fff"
              opacity=".9"
            >
              {alt ? 'NEON' : 'LUNA'}
            </text>
            <g fill="#30243e">
              <path d="M73 256Q79 201 93 187L95 155Q84 138 91 115Q102 89 125 93Q152 96 154 127L148 162L156 184Q172 212 178 256Z" />
              <ellipse cx="123" cy="140" rx="23" ry="31" fill="#d5b4b8" />
              <path d="M96 143Q102 103 139 113L154 138L150 109Q128 78 103 104Q85 120 96 153Z" />
              <path d="M96 185Q125 206 151 181L171 259H76Z" fill="#62527d" />
              <path d="M97 194L126 236L151 190" stroke="#e4d4fc" fill="none" strokeWidth="2" />
            </g>
            <g fill="#fff">
              <path d="M189 148L192 159L203 162L192 165L189 177L186 165L174 162L186 159Z" />
              <circle cx="49" cy="175" r="3" />
              <circle cx="185" cy="76" r="2" />
            </g>
          </>
        ) : pixel ? (
          <>
            <circle cx="120" cy="137" r="77" fill="#f0edcb" />
            <path d="M17 224L58 181L89 212L129 166L187 207L224 174V275H17Z" fill="#456f60" />
            <path d="M17 249L80 224L121 248L173 221L224 240V278H17Z" fill="#213f42" />
            <g fill={alt ? '#d7db8d' : '#f2e4c9'}>
              <path d="M89 122H105V109H139V123H153V183H139V198H105V185H89Z" />
              <rect x="74" y="146" width="15" height="30" />
              <rect x="153" y="145" width="15" height="31" />
              <rect x="104" y="197" width="14" height="20" />
              <rect x="130" y="197" width="14" height="20" />
            </g>
            <rect x="105" y="139" width="10" height="14" fill="#274b46" />
            <rect x="131" y="139" width="10" height="14" fill="#274b46" />
            <path d="M116 166H130V174H116Z" fill="#bd846a" />
            <rect x="52" y="87" width="9" height="9" fill="#fff" />
            <rect x="177" y="113" width="6" height="6" fill="#fff" />
          </>
        ) : (
          <>
            <g stroke="#fff" fill="none" opacity=".4">
              <circle cx="120" cy="160" r="91" />
              <circle cx="120" cy="160" r="76" />
              <path d="M25 160H215M120 64V256" />
            </g>
            <ellipse cx="120" cy="246" rx="67" ry="13" fill="#563f64" opacity=".2" />
            <path d="M68 166L120 78L173 165L120 249Z" fill={alt ? '#2b777b' : '#7b4679'} />
            <path d="M120 78V249L68 166Z" fill={alt ? '#65b2b6' : '#b77fac'} />
            <ellipse
              cx="121"
              cy="166"
              rx="94"
              ry="25"
              transform="rotate(-26 121 166)"
              stroke="#f8ebd0"
              strokeWidth="13"
              fill="none"
            />
            <circle cx="182" cy="92" r="14" fill="#f7ebd0" />
            <circle cx="57" cy="222" r="7" fill="#eef5d0" />
          </>
        )}
        <rect x="7" y="266" width="226" height="57" fill="#172724" opacity=".94" />
        <text x="23" y="286" fontSize="8" fill="#d6e1b4" letterSpacing="2">
          {sports
            ? 'THE GAME. THE CULTURE.'
            : pop
              ? 'THE NIGHT IS YOURS.'
              : pixel
                ? 'A WORLD OF YOUR OWN.'
                : 'COLLECT ANOTHER TOMORROW.'}
        </text>
        <text x="23" y="308" fontSize="17" fontWeight="800" fill="#fff">
          {sports
            ? alt
              ? 'COURTSIDE'
              : 'ABOVE THE RIM'
            : pop
              ? alt
                ? 'NEON'
                : 'LUNA'
              : pixel
                ? alt
                  ? 'FOREST SPIRIT'
                  : 'CLOUD RUNNER'
                : alt
                  ? 'SOFT GEOMETRY'
                  : 'ORBITAL'}
        </text>
        <rect
          x="7"
          y="7"
          width="226"
          height="316"
          rx="8"
          fill={`url(#foil-${uid})`}
          opacity=".35"
        />
      </svg>
    </div>
  );
}
