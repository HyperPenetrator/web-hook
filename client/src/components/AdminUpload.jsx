import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

export default function AdminUpload() {
  const [file, setFile] = useState(null);
  const [tags, setTags] = useState('');
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState(null); // { type: 'success' | 'error', message: string }
  const navigate = useNavigate();

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const showNotification = (type, message) => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification(null);
    }, 5000);
  };

  const handleLogout = () => {
    localStorage.removeItem('adminToken');
    navigate('/admin/login');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      showNotification('error', 'Please select a file to upload.');
      return;
    }

    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('tags', tags);

    const token = localStorage.getItem('adminToken');

    try {
      const response = await axios.post('/api/admin/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'Authorization': `Bearer ${token}`
        },
      });

      showNotification('success', `Upload successful! Document published and indexed.`);
      setFile(null);
      setTags('');
      e.target.reset();
    } catch (error) {
      console.error(error);
      const status = error.response?.status;
      
      if (status === 401 || status === 403) {
        showNotification('error', 'Session expired. Logging out...');
        setTimeout(() => {
          handleLogout();
        }, 1500);
      } else {
        const errorMsg = error.response?.data?.error || 'Failed to upload file. Please check backend connection.';
        showNotification('error', errorMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card-container fade-in" style={{ position: 'relative' }}>
      {/* Log out option at top-right */}
      <button 
        onClick={handleLogout} 
        style={{
          position: 'absolute',
          top: '1.25rem',
          right: '1.25rem',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          color: '#f87171',
          padding: '0.4rem 0.8rem',
          borderRadius: '6px',
          fontSize: '0.78rem',
          fontWeight: '600',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.target.style.background = 'rgba(239, 68, 68, 0.2)';
        }}
        onMouseLeave={(e) => {
          e.target.style.background = 'rgba(239, 68, 68, 0.1)';
        }}
      >
        Sign Out
      </button>

      <div className="card-header" style={{ marginRight: '5rem' }}>
        <h2>Admin Resource Portal</h2>
        <p>Upload study guides, syllabus documents, or learning resources. They will be auto-indexed using Gemini vector embeddings for student search.</p>
      </div>

      {notification && (
        <div className={`notification toast-${notification.type} slide-up`}>
          <span>{notification.message}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="form-layout">
        <div className="form-group">
          <label htmlFor="file-upload" className="form-label">Resource File</label>
          <div className="file-dropzone">
            <input
              type="file"
              id="file-upload"
              onChange={handleFileChange}
              className="file-input"
            />
            <div className="dropzone-text">
              {file ? (
                <span className="file-name-selected">Selected: {file.name}</span>
              ) : (
                <span>Click or drag file here to select</span>
              )}
            </div>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="tags" className="form-label">Search Keywords / Tags</label>
          <input
            type="text"
            id="tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="e.g., math, calculus, syllabus, physics-101"
            className="text-input"
          />
          <small className="help-text">Tags help Gemini contextualize the resource for semantic search matching.</small>
        </div>

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? (
            <div className="spinner-container">
              <span className="spinner"></span>
              Uploading & Indexing...
            </div>
          ) : (
            'Publish Resource'
          )}
        </button>
      </form>
    </div>
  );
}
