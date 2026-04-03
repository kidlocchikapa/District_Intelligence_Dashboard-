import { useState, useRef } from 'react';

export default function DataManagement({ token }) {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef(null);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const executeUpload = async () => {
    if (!file) return;
    setLoading(true);
    setLogs("Initiating secure upload to ETL pipeline...\n");

    const formData = new FormData();
    formData.append('dataset', file);

    try {
      const res = await fetch('/api/data/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Pipeline failure');
      }

      setLogs((prev) => prev + `\nPipeline exited securely.\n\n========== PIPELINE LOGS ==========\n${data.logs}`);
      setFile(null);
    } catch (err) {
      setLogs((prev) => prev + `\n\nERROR: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-panel data-mgmt-container">
      <h2>Data Ingestion Portal</h2>
      <p style={{color: "var(--text-secondary)", marginBottom: "2rem"}}>
        Upload raw datasets (.csv, .xlsx, .geojson). The Intelligent Pipeline will automatically resolve coordinate anomalies and index data into the PostGIS warehouse.
      </p>

      <div 
        className={`upload-zone ${dragActive ? "drag-active" : ""}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => inputRef.current.click()}
      >
        <div className="upload-icon">☁️</div>
        <h3>Drop files here or click to browse</h3>
        <p>Supported: CSV, Excel, GeoJSON</p>
        <input 
          ref={inputRef} 
          type="file" 
          onChange={handleChange} 
          style={{display: 'none'}} 
          accept=".csv,.xlsx,.xls,.geojson,.json"
        />
      </div>

      {file && (
        <div className="file-info">
          <div>
            <div className="file-name">{file.name}</div>
            <div style={{fontSize: "0.85rem", color: "var(--text-secondary)"}}>
              {(file.size / 1024).toFixed(2)} KB
            </div>
          </div>
          <button 
            className="btn-upload" 
            onClick={executeUpload}
            disabled={loading}
          >
            {loading ? <><span className="loader"></span> Processing...</> : 'Launch Pipeline'}
          </button>
        </div>
      )}

      {logs && (
        <div className="terminal">
          {logs}
        </div>
      )}
    </div>
  );
}
