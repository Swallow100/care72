// 今の場面の地（白地か青地）を部品に渡す
import React, { createContext, useContext } from "react";
import { type Ground, palette } from "./theme";

const GroundContext = createContext<Ground>("white");

export const GroundProvider: React.FC<{ ground: Ground; children: React.ReactNode }> = ({ ground, children }) => (
  <GroundContext.Provider value={ground}>{children}</GroundContext.Provider>
);

export function useGround(): Ground {
  return useContext(GroundContext);
}

export function usePalette() {
  return palette(useContext(GroundContext));
}
