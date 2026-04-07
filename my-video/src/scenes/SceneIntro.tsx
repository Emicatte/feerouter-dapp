import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { colors, fonts } from "../styles";

export const SceneIntro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Logo scale animation
  const logoScale = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 100, mass: 0.8 },
  });

  // Logo opacity
  const logoOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Text slide up
  const titleY = spring({
    frame: frame - 10,
    fps,
    config: { damping: 15, stiffness: 80 },
  });

  const titleOpacity = interpolate(frame, [10, 25], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Subtitle
  const subtitleOpacity = interpolate(frame, [20, 35], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Exit fade
  const exitOpacity = interpolate(frame, [45, 60], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Glow pulse
  const glowIntensity = interpolate(
    Math.sin(frame * 0.1),
    [-1, 1],
    [20, 40]
  );

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity: exitOpacity,
      }}
    >
      {/* Logo R */}
      <div
        style={{
          opacity: logoOpacity,
          transform: `scale(${logoScale})`,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            width: 120,
            height: 120,
            borderRadius: 28,
            background: `linear-gradient(135deg, ${colors.cyan}, ${colors.magenta})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: `0 0 ${glowIntensity}px ${colors.cyan}60`,
          }}
        >
          <span
            style={{
              fontSize: 72,
              fontWeight: 800,
              color: colors.bg,
              fontFamily: fonts.display,
            }}
          >
            R
          </span>
        </div>
      </div>

      {/* Title */}
      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${interpolate(titleY, [0, 1], [30, 0])}px)`,
        }}
      >
        <h1
          style={{
            fontSize: 72,
            fontWeight: 800,
            color: colors.text,
            fontFamily: fonts.display,
            margin: 0,
            letterSpacing: -2,
          }}
        >
          R
          <span style={{ color: colors.cyan }}>Sends</span>
        </h1>
      </div>

      {/* Subtitle */}
      <div style={{ opacity: subtitleOpacity }}>
        <p
          style={{
            fontSize: 24,
            color: colors.muted,
            fontFamily: fonts.mono,
            margin: 0,
            marginTop: 12,
            letterSpacing: 2,
          }}
        >
          WEB3 FINANCIAL AUTOMATION
        </p>
      </div>
    </AbsoluteFill>
  );
};
