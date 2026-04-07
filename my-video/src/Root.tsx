import React from "react";
import { Composition } from "remotion";
import { RSendsExplainer } from "./RSendsExplainer";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="RSendsExplainer"
        component={RSendsExplainer}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
