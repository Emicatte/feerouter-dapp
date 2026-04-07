import React from "react";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Easing,
} from "remotion";
import { colors, fonts } from "./styles";
import { SceneIntro } from "./scenes/SceneIntro";
import { SceneProblem } from "./scenes/SceneProblem";
import { SceneFlow } from "./scenes/SceneFlow";
import { SceneMultiChain } from "./scenes/SceneMultiChain";
import { SceneFeatures } from "./scenes/SceneFeatures";
import { SceneCTA } from "./scenes/SceneCTA";

// Background orbs animation (matching the app)
const BackgroundOrbs: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const orbs = [
    { x: 20, y: 30, size: 400, color: colors.cyan, speed: 0.3 },
    { x: 70, y: 60, size: 350, color: colors.magenta, speed: 0.4 },
    { x: 50, y: 20, size: 300, color: colors.cyan, speed: 0.25 },
    { x: 80, y: 80, size: 280, color: colors.magenta, speed: 0.35 },
  ];

  return (
    <AbsoluteFill>
      {orbs.map((orb, i) => {
        const time = frame / fps;
        const offsetX = Math.sin(time * orb.speed + i * 1.5) * 50;
        const offsetY = Math.cos(time * orb.speed * 0.8 + i * 2) * 30;

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${orb.x + offsetX * 0.1}%`,
              top: `${orb.y + offsetY * 0.1}%`,
              width: orb.size,
              height: orb.size,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${orb.color}15 0%, transparent 70%)`,
              filter: "blur(60px)",
              transform: "translate(-50%, -50%)",
              mixBlendMode: "screen" as const,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// Grid overlay
const GridOverlay: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 30], [0, 0.03], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        opacity,
        backgroundImage: `
          linear-gradient(${colors.cyan}08 1px, transparent 1px),
          linear-gradient(90deg, ${colors.cyan}08 1px, transparent 1px)
        `,
        backgroundSize: "60px 60px",
      }}
    />
  );
};

export const RSendsExplainer: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.bg,
        fontFamily: fonts.display,
        overflow: "hidden",
      }}
    >
      <BackgroundOrbs />
      <GridOverlay />

      {/* Scene 1: Logo intro (0-60 frames = 0-2s) */}
      <Sequence from={0} durationInFrames={60}>
        <SceneIntro />
      </Sequence>

      {/* Scene 2: Problem statement (50-110 frames) */}
      <Sequence from={50} durationInFrames={60}>
        <SceneProblem />
      </Sequence>

      {/* Scene 3: How it works - payment flow (100-190 frames) */}
      <Sequence from={100} durationInFrames={90}>
        <SceneFlow />
      </Sequence>

      {/* Scene 4: Multi-chain visualization (180-240 frames) */}
      <Sequence from={180} durationInFrames={60}>
        <SceneMultiChain />
      </Sequence>

      {/* Scene 5: Feature cards (230-280 frames) */}
      <Sequence from={230} durationInFrames={50}>
        <SceneFeatures />
      </Sequence>

      {/* Scene 6: CTA (270-300 frames) */}
      <Sequence from={270} durationInFrames={30}>
        <SceneCTA />
      </Sequence>
    </AbsoluteFill>
  );
};
