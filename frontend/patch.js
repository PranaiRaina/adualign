const fs = require('fs');
const path = './components/map/MapInterface.tsx';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
  `const handleAddressResult = useCallback((lng: number, lat: number, placeName: string) => {`,
  `const handleAddressResult = useCallback((lng: number, lat: number, placeName: string) => {\n    console.log('[DEBUG] handleAddressResult called, setting uiVisible to true');`,
);

code = code.replace(
  `const handleMapClick = useCallback(`,
  `const handleMapClick = useCallback(\n    async (e: any) => {\n      console.log('[DEBUG] handleMapClick called, result is:', !!result, 'isDraggingAdu:', isDraggingAdu);\n      if (isDrawingCustom || isDrawingCustomRef.current) return;\n      if (isDraggingAdu) return;\n      if (result) return;\n      const { lng, lat } = e.lngLat;\n      console.log('[DEBUG] handleMapClick continuing...');`,
);

code = code.replace(
  `async (e: { lngLat: { lng: number; lat: number } }) => {\n      // Prevent map clicks from resetting the property if we are currently drawing a custom ADU\n      if (isDrawingCustom || isDrawingCustomRef.current) return;\n\n      // Don't reset if the user just clicked/dragged the ADU shape itself\n      if (isDraggingAdu) return;\n\n      // If we already have an active property analysis, ignore stray map clicks.\n      // Users should use the explicit "Start Over" button in the HUD to clear state.\n      if (result) return;\n\n      const { lng, lat } = e.lngLat;`,
  ``,
);

code = code.replace(
  `if (e.key === 'Tab') {`,
  `if (e.key === 'Tab') {\n        console.log('[DEBUG] Tab key pressed, toggling uiVisible');`,
);

fs.writeFileSync(path, code);
