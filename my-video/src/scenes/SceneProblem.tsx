import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { colors, fonts } from "../styles";

export const SceneProblem: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enterOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });

  const exitOpacity = interpolate(frame, [45, 60], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const opacity = enterOpacity * exitOpacity;

  // Strikethrough animation on "complex"
  const strikeWidth = interpolate(frame, [20, 35], [0, 100], {
    extrapolateRight: "clamp",
  });

  // "Simple" word appears
  const simpleOpacity = interpolate(frame, [30, 40], [0, 1], {
    extrapolateRight: "clamp",
  });

  const simpleScale = spring({
    frame: frame - 30,
    fps,
    config: { damping: 10, stiffness: 120 },
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity,
      }}
    >
      <div style={{ textAlign: "center" }}>
        <p
          style={{
            fontSize: 28,
            color: colors.muted,
            fontFamily: fonts.mono,
            margin: 0,
            marginBottom: 16,
            textTransform: "uppercase",
            letterSpacing: 4,
          }}
        >
          Crypto payments are
        </p>

        <div style={{ position: "relative", display: "inline-block" }}>
          <h2
            style={{
              fontSize: 80,
              fontWeight: 800,
              color: colors.red,
              fontFamily: fonts.display,
              margin: 0,
              opacity: interpolate(simpleOpacity, [0, 1], [1, 0.3]),
            }}
          >
            COMPLEX
          </h2>
          {/* Strikethrough */}
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: 0,
              width: `${strikeWidth}%`,
              height: 4,
              backgroundColor: colors.red,
              transform: "translateY(-50%)",
            }}
          />
        </div>

        {/* Simple replacement */}
        <div
          style={{
            opacity: simpleOpacity,
            transform: `scale(${simpleScale})`,
            marginTop: -20,
          }}
        >
          <h2
            style={{
              fontSize: 80,
              fontWeight: 800,
              color: colors.cyan,
              fontFamily: fonts.display,
              margin: 0,
            }}
          >
            SIMPLE
          </h2>
          <p
            style={{
              fontSize: 24,
              color: colors.muted,
              fontFamily: fonts.mono,
              marginTop: 8,
            }}
          >
            with RSends
          </p>
        </div>
      </div>
    </AbsoluteFill>
  );
};
