import React, { createContext, useContext, useState } from 'react';

const DistrictContext = createContext();

export function DistrictProvider({ children }) {
  const [selectedDistrict, setSelectedDistrict] = useState('');

  return (
    <DistrictContext.Provider value={{ selectedDistrict, setSelectedDistrict }}>
      {children}
    </DistrictContext.Provider>
  );
}

export function useDistrict() {
  const context = useContext(DistrictContext);
  if (context === undefined) {
    throw new Error('useDistrict must be used within a DistrictProvider');
  }
  return context;
}
