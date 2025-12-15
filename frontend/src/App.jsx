import React, { useState, useRef, useEffect } from 'react';
import { Upload, Download, Pencil, Trash2, ZoomIn, ZoomOut, Type, Calendar, Image as ImageIcon, CheckCircle, Move } from 'lucide-react';

const FIELD_TOOLS = [
  { type: 'signature', label: 'Signature', icon: Pencil },
  { type: 'text', label: 'Text Box', icon: Type },
  { type: 'date', label: 'Date Selector', icon: Calendar },
  { type: 'image', label: 'Image Box', icon: ImageIcon }, 
  { type: 'radio', label: 'Radio Button', icon: CheckCircle }
];

const DEFAULT_FIELD_DIMS = {
  signature: { width: 180, height: 80 },
  text: { width: 150, height: 30 },
  date: { width: 100, height: 30 },
  image: { width: 100, height: 100 },
  radio: { width: 40, height: 40 } 
};

function App() {
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfDataUrl, setPdfDataUrl] = useState(null);
  
  const [fields, setFields] = useState([]);
  const [selectedFieldId, setSelectedFieldId] = useState(null);
  const [activeTool, setActiveTool] = useState(null); 
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [resizeHandle, setResizeHandle] = useState(null);
  
  const [zoom, setZoom] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // References for PDF container and dynamic field inputs/canvases
  const pdfContainerRef = useRef(null);
  const pdfViewerRef = useRef(null);
  const fieldRefs = useRef({}); 
  
  const A4_WIDTH = 595;
  const A4_HEIGHT = 842;
  
  const selectedField = fields.find(f => f.id === selectedFieldId);

  // --- Field Management Logic ---
  const generateId = () => `field-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  
  const updateField = (id, newProps) => {
    setFields(prev => prev.map(f => f.id === id ? { ...f, ...newProps } : f));
    
    // Re-focus the input element after state update to maintain typing continuity.
    if (newProps.value !== undefined) {
        setTimeout(() => {
            const currentElement = fieldRefs.current[id]; 
            const currentField = fields.find(f => f.id === id); 

            if (currentElement && id === selectedFieldId) {
                currentElement.focus();
                
                // Set cursor position to the end of text input
                if (currentField?.type === 'text') { 
                    const len = currentElement.value.length;
                    currentElement.setSelectionRange(len, len);
                }
            }
        }, 5); 
    }
  };

  const deleteField = (id) => {
    setFields(prev => prev.filter(f => f.id !== id));
    setSelectedFieldId(null);
  };
  
  const handlePdfUpload = (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'application/pdf') {
      setPdfFile(file);
      const url = URL.createObjectURL(file);
      setPdfDataUrl(url);
      setFields([]);
      setSelectedFieldId(null);
      setActiveTool(null);
    }
  };
  
  const startPlacement = (type) => {
    setActiveTool(activeTool === type ? null : type);
    setSelectedFieldId(null);
  };
  
  // Place a new field on the PDF viewer area
  const handlePdfClick = (e) => {
    if (!activeTool) return;
    
    const rect = pdfViewerRef.current.getBoundingClientRect();
    const pdfX = (e.clientX - rect.left) / zoom;
    const pdfY = (e.clientY - rect.top) / zoom;
    
    const dims = DEFAULT_FIELD_DIMS[activeTool] || DEFAULT_FIELD_DIMS.text;
    
    const newField = {
      id: generateId(),
      type: activeTool,
      pageNumber: 0, 
      x: Math.max(0, Math.min(pdfX, A4_WIDTH - dims.width)),
      y: Math.max(0, Math.min(pdfY, A4_HEIGHT - dims.height)),
      width: dims.width,
      height: dims.height,
      value: null,
    };
    
    setFields(prev => [...prev, newField]);
    setSelectedFieldId(newField.id);
    setActiveTool(null);
  };
  
  // --- Signature Drawing Logic ---
  const startDrawing = (e) => {
    if (!selectedField || selectedField.type !== 'signature' || isDragging || isResizing) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDrawing(true);
    
    const canvas = fieldRefs.current[selectedFieldId]; 
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    
    ctx.beginPath(); 
    ctx.moveTo(
      (e.clientX - rect.left) * (canvas.width / rect.width),
      (e.clientY - rect.top) * (canvas.height / rect.height)
    );
  };
  
  const draw = (e) => {
    if (!isDrawing || selectedField.type !== 'signature') return;
    e.preventDefault();
    e.stopPropagation();
    
    const canvas = fieldRefs.current[selectedFieldId]; 
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    
    ctx.lineTo(
      (e.clientX - rect.left) * (canvas.width / rect.width),
      (e.clientY - rect.top) * (canvas.height / rect.height)
    );
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
  };
  
  const stopDrawing = () => {
    if (isDrawing) {
      setIsDrawing(false);
      const canvas = fieldRefs.current[selectedFieldId]; 
      if (!canvas) return;
      
      // Save the canvas content as DataURL to field state
      const dataUrl = canvas.toDataURL('image/png');
      updateField(selectedFieldId, { value: dataUrl });
    }
  };
  
  const clearSignature = (e) => {
    if (e) e.stopPropagation();
    const canvas = fieldRefs.current[selectedFieldId]; 
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      updateField(selectedFieldId, { value: null });
    }
  };
  
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onloadend = () => {
            updateField(selectedFieldId, { value: reader.result });
        };
        reader.readAsDataURL(file);
    }
  };

  // --- Drag and Resize Handlers ---
  const handleBoxMouseDown = (e, fieldId) => {
    if (activeTool) return;
    e.preventDefault();
    e.stopPropagation();
    setSelectedFieldId(fieldId);
    setIsDragging(true);
    
    const field = fields.find(f => f.id === fieldId);
    const rect = pdfViewerRef.current.getBoundingClientRect();
    const startPdfX = (e.clientX - rect.left) / zoom;
    const startPdfY = (e.clientY - rect.top) / zoom;
    
    setDragStart({
      startPdfX, startPdfY,
      boxX: field.x,
      boxY: field.y
    });
  };
  
  const handleResizeMouseDown = (e, handle, fieldId) => {
    if (activeTool) return;
    e.preventDefault();
    e.stopPropagation();
    setSelectedFieldId(fieldId);
    setIsResizing(true);
    setResizeHandle(handle);
    
    const field = fields.find(f => f.id === fieldId);
    const rect = pdfViewerRef.current.getBoundingClientRect();
    const startPdfX = (e.clientX - rect.left) / zoom;
    const startPdfY = (e.clientY - rect.top) / zoom;
    
    setDragStart({
      startPdfX, startPdfY,
      boxX: field.x,
      boxY: field.y,
      boxWidth: field.width,
      boxHeight: field.height
    });
  };
  
  const handleMouseMove = (e) => {
    if (!dragStart || !selectedField) return;
    const rect = pdfViewerRef.current.getBoundingClientRect();
    const currentPdfX = (e.clientX - rect.left) / zoom;
    const currentPdfY = (e.clientY - rect.top) / zoom;
    
    const minWidth = 50, minHeight = 30;
    
    if (isDragging) {
      const deltaPdfX = currentPdfX - dragStart.startPdfX;
      const deltaPdfY = currentPdfY - dragStart.startPdfY;
      
      let newX = dragStart.boxX + deltaPdfX;
      let newY = dragStart.boxY + deltaPdfY;
      
      newX = Math.max(0, Math.min(newX, A4_WIDTH - selectedField.width));
      newY = Math.max(0, Math.min(newY, A4_HEIGHT - selectedField.height));
      
      updateField(selectedFieldId, { x: newX, y: newY });
      
    } else if (isResizing && resizeHandle) {
      const deltaPdfX = currentPdfX - dragStart.startPdfX;
      const deltaPdfY = currentPdfY - dragStart.startPdfY;
      let newX = dragStart.boxX, newY = dragStart.boxY;
      let newWidth = dragStart.boxWidth, newHeight = dragStart.boxHeight;
      
      // Calculate new width/height based on handle (e.g., 'nw', 'se')
      if (resizeHandle.includes('e')) newWidth = Math.max(minWidth, dragStart.boxWidth + deltaPdfX);
      if (resizeHandle.includes('w')) {
        const widthChange = Math.min(deltaPdfX, dragStart.boxWidth - minWidth);
        newWidth = dragStart.boxWidth - widthChange;
        newX = dragStart.boxX + widthChange;
      }
      if (resizeHandle.includes('s')) newHeight = Math.max(minHeight, dragStart.boxHeight + deltaPdfY);
      if (resizeHandle.includes('n')) {
        const heightChange = Math.min(deltaPdfY, dragStart.boxHeight - minHeight);
        newHeight = dragStart.boxHeight - heightChange;
        newY = dragStart.boxY + heightChange;
      }
      
      // Boundary check against PDF edges
      if (newX < 0) { newWidth += newX; newX = 0; }
      if (newY < 0) { newHeight += newY; newY = 0; }
      if (newX + newWidth > A4_WIDTH) newWidth = A4_WIDTH - newX;
      if (newY + newHeight > A4_HEIGHT) newHeight = A4_HEIGHT - newY;
      
      updateField(selectedFieldId, { x: newX, y: newY, width: newWidth, height: newHeight });
    }
  };
  
  const handleMouseUp = () => {
    setIsDragging(false);
    setIsResizing(false);
    setResizeHandle(null);
    setDragStart(null);
  };

  // Attach global mouse listeners for dragging/resizing
  useEffect(() => {
    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isResizing, dragStart, selectedField, zoom]);


  // --- Data Transformation for Submission ---
  const getNormalizedCoordinates = (field) => {
    let finalValue = field.value;

    // Convert date format from YYYY-MM-DD (HTML default) to DD/MM/YYYY for the PDF
    if (field.type === 'date' && field.value) {
      const parts = field.value.split('-'); 
      if (parts.length === 3) {
        finalValue = `${parts[2]}/${parts[1]}/${parts[0]}`; 
      }
    }

    return {
      id: field.id,
      type: field.type,
      pageNumber: field.pageNumber,
      value: finalValue, 
      // Send dimensions as a percentage of A4 (normalized coordinates)
      xPct: field.x / A4_WIDTH,
      yPct: field.y / A4_HEIGHT,
      wPct: field.width / A4_WIDTH,
      hPct: field.height / A4_HEIGHT,
    };
  };
  
  const handleSubmit = async () => {
    if (fields.length === 0) {
      alert('Please place fields first');
      return;
    }
    if (!pdfFile) {
        alert('Please upload a PDF file first');
        return;
    }

    const fieldsPayload = fields.map(getNormalizedCoordinates);
    
    const BACKEND_URL = import.meta.env.VITE_API_URL;
    
    if (!BACKEND_URL) {
        alert('Configuration Error: Backend API URL (VITE_API_URL) is not defined in the environment.');
        console.error("VITE_API_URL is missing. Check .env files in the 'frontend/' directory.");
        return;
    }

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('pdf', pdfFile);
      formData.append('fields', JSON.stringify(fieldsPayload)); 
      
      const response = await fetch(`${BACKEND_URL}/api/burn-fields`, { 
          method: 'POST', 
          body: formData 
      });
      
      if (!response.ok) {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
              throw new Error((await response.json()).message || 'Failed to sign PDF');
          } else {
              throw new Error(`Server returned status ${response.status}. Check backend logs on Render/Railway.`);
          }
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `signed_${pdfFile.name}`;
      a.click();
      window.URL.revokeObjectURL(url);
      alert('✓ PDF signed successfully!');
    } catch (error) {
      alert(`Submission Failed: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
};

  // --- Field Renderer Component ---
  const FieldComponent = ({ field }) => {
    const isSelected = field.id === selectedFieldId;
    const isSignature = field.type === 'signature';
    const isImage = field.type === 'image';
    const isInput = field.type === 'text' || field.type === 'date';
    const isRadio = field.type === 'radio';
    
    const IconComponent = FIELD_TOOLS.find(t => t.type === field.type)?.icon;

    const localCanvasRef = useRef(null); 
    
    // Use local state for date input to prevent re-renders on every keystroke (enables native behavior)
    const [localDateValue, setLocalDateValue] = useState(field.value || '');
    
    // Sync local state when the field value changes externally
    useEffect(() => {
        setLocalDateValue(field.value || '');
    }, [field.value]);


    // Dynamic callback ref to manage the element reference map (fieldRefs)
    const setElementRef = (el) => {
        if (el) {
            fieldRefs.current[field.id] = el;
            localCanvasRef.current = el;
        } else {
            delete fieldRefs.current[field.id];
            localCanvasRef.current = null;
        }
    };

    // Redraw signature from stored DataURL when canvas dimensions/value change
    useEffect(() => {
        if (field.type !== 'signature') return;

        const canvas = localCanvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            if (field.value) {
                const img = new window.Image(); 
                img.crossOrigin = "anonymous"; 
                img.onload = () => {
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                };
                img.src = field.value;
            }
        }
    }, [field.value, field.width, field.height]);
    
    return (
      <div 
        className={`absolute border-2 transition-all duration-100 ${isSelected ? 'border-blue-500 ring-4 ring-blue-300 z-10' : 'border-dashed border-gray-400 hover:border-blue-500'}`}
        style={{ 
          left: field.x * zoom, 
          top: field.y * zoom, 
          width: field.width * zoom, 
          height: field.height * zoom, 
          cursor: isSelected ? (isDrawing ? 'crosshair' : 'grab') : 'pointer',
          backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.1)' : 'rgba(243, 244, 246, 0.5)'
        }}
        onMouseDown={(e) => {
            // Prevent drag from starting if interaction is within an input/canvas
            const targetTag = e.target.tagName.toLowerCase();
            if (targetTag === 'input' || targetTag === 'canvas' || targetTag === 'button') {
                e.stopPropagation(); 
            } else {
                handleBoxMouseDown(e, field.id);
            }
        }}
        onClick={() => setSelectedFieldId(field.id)}
      >
        
        {/* Field Icon, Label, and Delete Button */}
        <div className="absolute -top-6 left-0 bg-gray-700 text-white text-xs px-2 py-0.5 rounded-t shadow-md flex items-center gap-1 cursor-default">
          {IconComponent && <IconComponent className="w-3 h-3" />}
          {FIELD_TOOLS.find(t => t.type === field.type)?.label}
          {isSelected && (
              <Trash2 
                  className="w-3 h-3 ml-2 cursor-pointer text-red-300 hover:text-red-500" 
                  onClick={(e) => { 
                      e.stopPropagation(); 
                      deleteField(field.id); 
                  }} 
                  // Stop propagation on mousedown too, to prevent drag initiation
                  onMouseDown={(e) => e.stopPropagation()} 
              />
          )}
        </div>
        
        {/* --- Signature Field --- */}
        {isSignature && ( 
          <canvas 
            ref={setElementRef} 
            width={field.width * 2} 
            height={field.height * 2}
            className="w-full h-full"
            style={{ 
              pointerEvents: isSelected && !(isDragging || isResizing) ? 'auto' : 'none', 
              cursor: isDrawing ? 'crosshair' : 'grab'
            }}
            onMouseDown={startDrawing} 
            onMouseMove={draw} 
            onMouseUp={stopDrawing} 
            onMouseLeave={stopDrawing} 
          />
        )}

        {/* --- Image Field --- */}
        {(isImage) && field.value && (
             <img src={field.value} alt="Field Content" className="w-full h-full object-contain pointer-events-none" />
        )}
        {isImage && isSelected && !field.value && (
            <label 
                onMouseDown={(e) => e.stopPropagation()}
                className="w-full h-full flex flex-col items-center justify-center text-gray-500 text-xs cursor-pointer">
                <Upload className="w-5 h-5 mb-1" />
                Click to Upload Image
                <input type="file" accept="image/*" onChange={handleImageUpload} onClick={(e) => e.stopPropagation()} className="hidden" />
            </label>
        )}
        
        {/* --- Text/Date Input Field --- */}
        {isInput && (
          <input 
            type={field.type === 'date' ? 'date' : 'text'}
            // Use local state for date inputs to maintain native focus/typing
            value={field.type === 'date' ? localDateValue : field.value || ''} 
            
            onChange={(e) => {
                const newValue = e.target.value;
                if (field.type === 'date') {
                    setLocalDateValue(newValue);
                } else {
                    updateField(field.id, { value: newValue });
                }
            }}

            // Update global state only when focus is lost for date input
            onBlur={(e) => {
                if (field.type === 'date') {
                    updateField(field.id, { value: localDateValue });
                }
            }}
            
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()} 
            ref={setElementRef} 
            className={`w-full h-full p-1 bg-white bg-opacity-70 text-sm border-2 ${isSelected ? 'border-blue-500' : 'border-gray-300'} focus:ring-blue-500 focus:border-blue-500`}
            placeholder={field.type === 'date' ? 'Select Date' : 'Type Text'}
          />
        )}

        {/* --- Radio Button Field --- */}
        {isRadio && (
            <div className="w-full h-full flex items-center justify-center">
                <div className={`w-3/4 h-3/4 rounded-full border-2 ${isSelected ? 'border-blue-500' : 'border-gray-500'} flex items-center justify-center`}>
                    {field.value && (
                        <div className="w-1/2 h-1/2 bg-blue-600 rounded-full" />
                    )}
                </div>
                {isSelected && (
                    <button 
                        onMouseDown={(e) => e.stopPropagation()}
                        className="absolute right-0 top-0 w-full h-full opacity-0"
                        onClick={(e) => { e.stopPropagation(); updateField(field.id, { value: field.value ? null : 'checked' }); }}
                    />
                )}
            </div>
        )}

        {/* --- Resize Handles --- */}
        {isSelected && !isRadio && ['nw', 'ne', 'sw', 'se'].map(h => (
          <div key={h} 
               className="absolute w-4 h-4 bg-blue-600 border-2 border-white rounded-full hover:scale-125 transition z-20"
               style={{ 
                 [h.includes('n') ? 'top' : 'bottom']: -8, 
                 [h.includes('w') ? 'left' : 'right']: -8, 
                 cursor: `${h}-resize` 
               }}
               onMouseDown={(e) => handleResizeMouseDown(e, h, field.id)} />
        ))}
        
      </div>
    );
  };
  
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        
        {/* Header and Controls */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">BoloForms Signature Injection Engine</h1>
            <p className="text-gray-600">Drag, Drop, and Edit Fields Flawlessly.</p>
          </div>
          <div className="text-xs bg-white px-3 py-2 rounded border">
            
          </div>
        </div>
        
        {!pdfFile ? (
          <div className="bg-white rounded-lg shadow-lg p-12">
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-500 p-12">
              <Upload className="w-16 h-16 text-gray-400 mb-4" />
              <span className="text-lg font-medium text-gray-700 mb-2">Upload PDF Document</span>
              <span className="text-sm text-gray-500">Click to browse</span>
              <input type="file" accept="application/pdf" onChange={handlePdfUpload} className="hidden" />
            </label>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-white rounded-lg shadow-lg p-4">
              
              {/* Tool Palette and Actions */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-700 mr-2">Tools:</span>
                  {FIELD_TOOLS.map(tool => {
                    const Icon = tool.icon; 
                    return (
                        <button key={tool.type} onClick={() => startPlacement(tool.type)} 
                            className={`px-3 py-2 text-sm rounded flex items-center gap-2 transition ${
                              activeTool === tool.type ? 'bg-indigo-600 text-white shadow-md' : 'bg-gray-100 hover:bg-gray-200 text-gray-800'
                            }`}
                            title={`Click to place a ${tool.label}`}
                            >
                            <Icon className="w-4 h-4" />
                            {tool.label}
                        </button>
                    );
                  })}
                </div>
                
                <div className="flex gap-2">
                  <button onClick={() => setZoom(Math.max(0.5, zoom - 0.25))} className="p-2 bg-gray-100 rounded hover:bg-gray-200">
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <span className="text-sm font-medium min-w-[60px] text-center p-2 bg-gray-100 rounded">{(zoom * 100).toFixed(0)}%</span>
                  <button onClick={() => setZoom(Math.min(2, zoom + 0.25))} className="p-2 bg-gray-100 rounded hover:bg-gray-200">
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  
                  
                  <button onClick={handleSubmit} disabled={fields.length === 0 || isSubmitting} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-2 disabled:opacity-50">
                    <Download className="w-4 h-4" />{isSubmitting ? 'Generating...' : 'Generate Signed PDF'}
                  </button>
                </div>
              </div>
              
              {/* PDF Viewer Area */}
              <div ref={pdfContainerRef} className="relative overflow-auto bg-gray-100 rounded border-2 border-gray-300" style={{ maxHeight: '75vh' }}>
                <div ref={pdfViewerRef} className={`relative bg-white mx-auto shadow-xl ${activeTool ? 'cursor-copy' : 'cursor-default'}`} 
                     style={{ width: A4_WIDTH * zoom, height: A4_HEIGHT * zoom }} 
                     onClick={handlePdfClick}
                     >
                  {pdfDataUrl && (
                    <object 
                      data={`${pdfDataUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`} 
                      type="application/pdf" 
                      className="w-full h-full pointer-events-none"
                      title="PDF Preview"
                    >
                      <embed src={`${pdfDataUrl}#toolbar=0&navpanes=0&scrollbar=0`} type="application/pdf" className="w-full h-full" />
                    </object>
                  )}
                  
                  {fields.map(field => <FieldComponent key={field.id} field={field} />)}
                  
                  {activeTool && (
                     <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-indigo-600 text-white text-sm px-4 py-2 rounded-full shadow-lg pointer-events-none flex items-center gap-2">
                         <Move className="w-4 h-4" /> Click anywhere on the PDF to place the **{FIELD_TOOLS.find(t => t.type === activeTool)?.label}**
                     </div>
                  )}
                </div>
              </div>
            </div>
            
            {/* Debug/Info Panel */}
            {selectedField && (
              <div className="bg-white rounded-lg shadow-lg p-4">
                <h3 className="font-semibold mb-2">📊 Selected Field Coordinates (Field ID: {selectedField.id.slice(-6)})</h3>
                <div className="grid grid-cols-4 gap-4 text-xs">
                    
                  <div className="bg-blue-50 p-2 rounded col-span-2">
                    <div className="font-semibold text-blue-900">PDF Space (A4 Pts, Top-Left Origin)</div>
                    <div className="text-blue-700">X: {selectedField.x.toFixed(1)} pts, Y: {selectedField.y.toFixed(1)} pts</div>
                    <div className="text-blue-700">W: {selectedField.width.toFixed(1)} pts, H: {selectedField.height.toFixed(1)} pts</div>
                  </div>
                  <div className="bg-green-50 p-2 rounded col-span-2">
                    <div className="font-semibold text-green-900">Normalized (%) Payload to Backend</div>
                    <div className="text-green-700">X: {(selectedField.x / A4_WIDTH * 100).toFixed(2)}%, Y: {(selectedField.y / A4_HEIGHT * 100).toFixed(2)}%</div>
                    <div className="text-green-700">W: {(selectedField.width / A4_WIDTH * 100).toFixed(2)}%, H: {(selectedField.height / A4_HEIGHT * 100).toFixed(2)}%</div>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-2 italic">
                  The Backend uses the Normalized (%) values and the PDF's **actual** dimensions to guarantee reliable placement.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;