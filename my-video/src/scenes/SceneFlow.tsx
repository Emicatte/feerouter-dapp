import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { colors, fonts } from "../styles";

const FlowNode: React.FC<{
  label: string;
  sublabel: string;
  x: number;
  y: number;
  delay: number;
  icon: string;
  color: string;
}> = ({ label, sublabel, x, y, delay, icon, color }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

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
        position: "absolute",
        left: x,
        top: y,
        transform: `scale(${scale}) translate(-50%, -50%)`,
        opacity,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: 20,
          background: `${color}15`,
          border: `2px solid ${color}40`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 36,
          marginBottom: 12,
          boxShadow: `0 0 30px ${color}20`,
        }}
      >
        {icon}
      </div>
      <span
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: colors.text,
          fontFamily: fonts.display,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 13,
          color: colors.muted,
          fontFamily: fonts.mono,
          marginTop: 4,
        }}
      >
        {sublabel}
      </span>
    </div>
  );
};

const FlowArrow: React.FC<{
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  delay: number;
  color: string;
}> = ({ x1, y1, x2, y2, delay, color }) => {
  const frame = useCurrentFrame();

  const progress = interpolate(frame, [delay, delay + 15], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  return (
    <div
      style={{
        position: "absolute",
        left: x1,
        top: y1,
        width: len * progress,
        height: 3,
        background: `linear-gradient(90deg, ${color}, ${color}60)`,
        transform: `rotate(${angle}deg)`,
        transformOrigin: "0 50%",
        borderRadius: 2,
        boxShadow: `0 0 10px ${color}40`,
      }}
    />
  );
};

export const SceneFlow: React.FC = () => {
  const frame = useCurrentFrame();

  const enterOpacity = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });

  const exitOpacity = interpolate(frame, [75, 90], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Animated amount counter
  const amount = interpolate(frame, [30, 55], [0, 1000], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  const feeAmount = amount * 0.005;

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity: enterOpacity * exitOpacity,
      }}
    >
      {/* Title */}
      <div
        style={{
          position: "absolute",
          top: 120,
          textAlign: "center",
          width: "100%",
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
          How it{" "}
          <span style={{ color: colors.cyan }}>works</span>
        </h2>
      </div>

      {/* Flow diagram */}
      <div
        style={{
          position: "relative",
          width: 1200,
          height: 400,
          marginTop: 60,
        }}
      >
        {/* Arrows */}
        <FlowArrow
          x1={250}
          y1={200}
          x2={480}
          y2={200}
          delay={15}
          color={colors.cyan}
        />
        <FlowArrow
          x1={620}
          y1={200}
          x2={850}
          y2={150}
          delay={30}
          color={colors.cyan}
        />
        <FlowArrow
          x1={620}
          y1={200}
          x2={850}
          y2={280}
          delay={30}
          color={colors.amber}
        />

        {/* Nodes */}
        <FlowNode
          label="Sender"
          sublabel="Your wallet"
          x={180}
          y={200}
          delay={5}
          icon="👤"
          color={colors.blue}
        />
        <FlowNode
          label="FeeRouter"
          sublabel="Smart Contract"
          x={550}
          y={200}
          delay={15}
          icon="⚡"
          color={colors.cyan}
        />
        <FlowNode
          label="Recipient"
          sublabel={`${amount >= 1000 ? "995.00" : (amount * 0.995).toFixed(2)} USDC`}
          x={950}
          y={150}
          delay={30}
          icon="✅"
          color={colors.cyan}
        />
        <FlowNode
          label="Treasury"
          sublabel={`${feeAmount >= 5 ? "5.00" : feeAmount.toFixed(2)} USDC`}
          x={950}
          y={300}
          delay={35}
          icon="🏦"
          color={colors.amber}
        />

        {/* Fee label */}
        {frame > 40 && (
          <div
            style={{
              position: "absolute",
              left: 550,
              top: 80,
              transform: "translateX(-50%)",
              opacity: interpolate(frame, [40, 50], [0, 1], {
                extrapolateRight: "clamp",
              }),
            }}
          >
            <div
              style={{
                background: `${colors.card}`,
                border: `1px solid ${colors.amber}40`,
                borderRadius: 12,
                padding: "8px 20px",
                fontFamily: fonts.mono,
                fontSize: 16,
                color: colors.amber,
              }}
            >
              0.5% fee split
            </div>
          </div>
        )}

        {/* Amount display */}
        {frame > 25 && (
          <div
            style={{
              position: "absolute",
              left: 380,
              top: 145,
              opacity: interpolate(frame, [25, 35], [0, 1], {
                extrapolateRight: "clamp",
              }),
            }}
          >
            <span
              style={{
                fontFamily: fonts.mono,
                fontSize: 20,
                fontWeight: 700,
                color: colors.cyan,
              }}
            >
              {amount >= 1000 ? "1,000" : Math.floor(amount).toLocaleString()}{" "}
              USDC
            </span>
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
