import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

export default function AdminLogin() {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState(null);
  const navigate = useNavigate();

  const showNotification = (type, message) => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification(null);
    }, 5000);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password.trim()) {
      showNotification('error', 'Please enter your password.');
      return;
    }

    setLoading(true);

    try {
      const response = await axios.post('/api/admin/login', { password });
      localStorage.setItem('adminToken', response.data.token);
      showNotification('success', 'Logged in successfully!');
      
      // Redirect to Admin portal after 1s
      setTimeout(() => {
        navigate('/admin');
      }, 1000);
    } catch (error) {
      console.error(error);
      const errorMsg = error.response?.data?.error || 'Login failed. Please check your credentials.';
      showNotification('error', errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card-container fade-in" style={{ maxWidth: '440px' }}>
      <div className="card-header">
        <h2>Admin Authentication</h2>
        <p>Enter the administrator password to access the document upload and indexing portal.</p>
      </div>

      {notification && (
        <div className={`notification toast-${notification.type} slide-up`}>
          <span>{notification.message}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="form-layout">
        <div className="form-group">
          <label htmlFor="admin-password" className="form-label">Password</label>
          <input
            type="password"
            id="admin-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••••"
            className="text-input"
            autoFocus
          />
        </div>

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? (
            <div className="spinner-container">
              <span className="spinner"></span>
              Authenticating...
            </div>
          ) : (
            'Access Portal'
          )}
        </button>
      </form>
    </div>
  );
}
