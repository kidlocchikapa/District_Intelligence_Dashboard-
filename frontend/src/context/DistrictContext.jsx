import React, { createContext, useContext, useState } from 'react';

const DistrictContext = createContext();

export function DistrictProvider({ children }) {
  const [selectedDistrict, setSelectedDistrict] = useState('');
  const [selectedTa, setSelectedTa] = useState('');

  const updateSelectedDistrict = (district) => {
    setSelectedDistrict(district);
    setSelectedTa('');
  };

  return (
    <DistrictContext.Provider
      value={{
        selectedDistrict,
        setSelectedDistrict: updateSelectedDistrict,
        selectedTa,
        setSelectedTa,
      }}
    >
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
