import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { colors, fonts } from "../styles";

const features = [
  {
    icon: "🔒",
    title: "Non-Custodial",
    desc: "Your keys, your funds",
    color: colors.cyan,
  },
  {
    icon: "📊",
    title: "DAC8 Compliant",
    desc: "Built-in reporting",
    color: colors.amber,
  },
  {
    icon: "⚡",
    title: "Instant",
    desc: "Real-time settlement",
    color: colors.magenta,
  },
  {
    icon: "🛡️",
    title: "Anti-Phishing",
    desc: "Address verification",
    color: colors.purple,
  },
];

const FeatureCard: React.FC<{
  feature: (typeof features)[0];
  index: number;
}> = ({ feature, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const delay = index * 5;

  const scale = spring({
    frame: frame - delay,
    fps,
    config: { damping: 12, stiffness: 100 },
  });

  const opacity = interpolate(frame, [delay, delay + 10], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  return (
    <div
      style={{
        opacity,
        transform: `scale(${scale})`,
        background: `${colors.card}`,
        border: `1px solid ${feature.color}25`,
        borderRadius: 20,
        padding: "32px 28px",
        width: 240,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        boxShadow: `0 0 30px ${feature.color}10`,
      }}
    >
      <div style={{ fontSize: 40 }}>{feature.icon}</div>
      <h3
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: feature.color,
          fontFamily: fonts.display,
          margin: 0,
        }}
      >
        {feature.title}
      </h3>
      <p
        style={{
          fontSize: 14,
          color: colors.muted,
          fontFamily: fonts.mono,
          margin: 0,
          textAlign: "center",
        }}
      >
        {feature.desc}
      </p>
    </div>
  );
};

export const SceneFeatures: React.FC = () => {
  const frame = useCurrentFrame();

  const enterOpacity = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });

  const exitOpacity = interpolate(frame, [35, 50], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity: enterOpacity * exitOpacity,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 24,
        }}
      >
        {features.map((f, i) => (
          <FeatureCard key={f.title} feature={f} index={i} />
        ))}
      </div>
    </AbsoluteFill>
  );
};
