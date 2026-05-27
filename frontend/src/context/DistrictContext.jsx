import React, { createContext, useContext, useState } from 'react';

const DistrictContext = createContext();
const DEFAULT_DISTRICT = 'Zomba';

export function DistrictProvider({ children }) {
  const [selectedDistrict, setSelectedDistrict] = useState(DEFAULT_DISTRICT);
  const [selectedTa, setSelectedTa] = useState('');

  const updateSelectedDistrict = (district) => {
    setSelectedDistrict(district || DEFAULT_DISTRICT);
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

// eslint-disable-next-line react-refresh/only-export-components
export function useDistrict() {
  const context = useContext(DistrictContext);
  if (context === undefined) {
    throw new Error('useDistrict must be used within a DistrictProvider');
  }
  return context;
}
