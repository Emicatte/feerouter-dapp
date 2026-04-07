import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { colors, fonts } from "../styles";

const chains = [
  { name: "Base", color: "#0052FF", symbol: "B" },
  { name: "Ethereum", color: "#627EEA", symbol: "E" },
  { name: "Arbitrum", color: "#28A0F0", symbol: "A" },
  { name: "Polygon", color: "#8247E5", symbol: "P" },
  { name: "Optimism", color: "#FF0420", symbol: "O" },
  { name: "Solana", color: "#9945FF", symbol: "S" },
  { name: "BNB", color: "#F3BA2F", symbol: "B" },
  { name: "Avalanche", color: "#E84142", symbol: "V" },
];

const ChainBadge: React.FC<{
  chain: (typeof chains)[0];
  index: number;
  total: number;
}> = ({ chain, index, total }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const delay = index * 3;
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
  const radius = 220;
  const centerX = 960;
  const centerY = 500;

  const scale = spring({
    frame: frame - delay,
    fps,
    config: { damping: 12, stiffness: 120 },
  });

  const opacity = interpolate(frame, [delay, delay + 8], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  // Orbit animation
  const orbitOffset = (frame - delay) * 0.005;
  const x = centerX + Math.cos(angle + orbitOffset) * radius;
  const y = centerY + Math.sin(angle + orbitOffset) * radius;

  // Connection line to center
  const lineOpacity = interpolate(frame, [delay + 5, delay + 12], [0, 0.3], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  return (
    <>
      {/* Connection line */}
      <svg
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      >
        <line
          x1={centerX}
          y1={centerY}
          x2={x}
          y2={y}
          stroke={chain.color}
          strokeWidth={1.5}
          opacity={lineOpacity}
          strokeDasharray="4 4"
        />
      </svg>

      {/* Chain badge */}
      <div
        style={{
          position: "absolute",
          left: x,
          top: y,
          transform: `translate(-50%, -50%) scale(${scale})`,
          opacity,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div
          style={{
            width: 60,
            height: 60,
            borderRadius: 16,
            background: `${chain.color}20`,
            border: `2px solid ${chain.color}50`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 24,
            fontWeight: 800,
            color: chain.color,
            fontFamily: fonts.display,
            boxShadow: `0 0 20px ${chain.color}30`,
          }}
        >
          {chain.symbol}
        </div>
        <span
          style={{
            fontSize: 13,
            color: colors.muted,
            fontFamily: fonts.mono,
          }}
        >
          {chain.name}
        </span>
      </div>
    </>
  );
};

export const SceneMultiChain: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enterOpacity = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });

  const exitOpacity = interpolate(frame, [45, 60], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Center RSends logo pulse
  const pulse = interpolate(Math.sin(frame * 0.15), [-1, 1], [0.95, 1.05]);

  return (
    <AbsoluteFill
      style={{
        opacity: enterOpacity * exitOpacity,
      }}
    >
      {/* Title */}
      <div
        style={{
          position: "absolute",
          top: 100,
          width: "100%",
          textAlign: "center",
        }}
      >
        <h2
          style={{
            fontSize: 42,
            fontWeight: 700,
            color: colors.text,
            fontFamily: fonts.display,
            margin: 0,
          }}
        >
          One protocol,{" "}
          <span style={{ color: colors.cyan }}>every chain</span>
        </h2>
      </div>

      {/* Center hub */}
      <div
        style={{
          position: "absolute",
          left: 960,
          top: 500,
          transform: `translate(-50%, -50%) scale(${pulse})`,
        }}
      >
        <div
          style={{
            width: 100,
            height: 100,
            borderRadius: 24,
            background: `linear-gradient(135deg, ${colors.cyan}30, ${colors.magenta}30)`,
            border: `2px solid ${colors.cyan}40`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: `0 0 40px ${colors.cyan}20`,
          }}
        >
          <span
            style={{
              fontSize: 44,
              fontWeight: 800,
              color: colors.cyan,
              fontFamily: fonts.display,
            }}
          >
            R
          </span>
        </div>
      </div>

      {/* Chain badges orbiting */}
      {chains.map((chain, i) => (
        <ChainBadge
          key={chain.name}
          chain={chain}
          index={i}
          total={chains.length}
        />
      ))}
    </AbsoluteFill>
  );
};
