import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { colors, fonts } from "../styles";

export const SceneCTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({
    frame,
    fps,
    config: { damping: 10, stiffness: 80 },
  });

  const opacity = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Glow pulse
  const glow = interpolate(Math.sin(frame * 0.2), [-1, 1], [30, 60]);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity,
      }}
    >
      <div
        style={{
          transform: `scale(${scale})`,
          textAlign: "center",
        }}
      >
        <h2
          style={{
            fontSize: 64,
            fontWeight: 800,
            color: colors.text,
            fontFamily: fonts.display,
            margin: 0,
            marginBottom: 24,
          }}
        >
          Start{" "}
          <span
            style={{
              color: colors.cyan,
              textShadow: `0 0 ${glow}px ${colors.cyan}60`,
            }}
          >
            sending
          </span>
        </h2>

        {/* CTA Button */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            background: `linear-gradient(135deg, ${colors.cyan}, ${colors.cyan}cc)`,
            borderRadius: 16,
            padding: "18px 48px",
            boxShadow: `0 0 ${glow}px ${colors.cyan}40`,
          }}
        >
          <span
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: colors.bg,
              fontFamily: fonts.display,
              letterSpacing: 1,
            }}
          >
            Launch App
          </span>
          <span
            style={{
              fontSize: 22,
              color: colors.bg,
            }}
          >
            →
          </span>
        </div>

        <p
          style={{
            fontSize: 16,
            color: colors.muted,
            fontFamily: fonts.mono,
            marginTop: 20,
          }}
        >
          rsends.com
        </p>
      </div>
    </AbsoluteFill>
  );
};
