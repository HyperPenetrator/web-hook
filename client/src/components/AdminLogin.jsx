import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

export default function AdminLogin() {
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState(null);
  const navigate = useNavigate();

  const showNotification = (type, message) => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification(null);
    }, 5000);
  };

  const handleModeToggle = () => {
    setIsRegisterMode(!isRegisterMode);
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setNotification(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (isRegisterMode) {
      if (!email.trim() || !password.trim()) {
        showNotification('error', 'Please fill in all fields.');
        return;
      }
      if (password !== confirmPassword) {
        showNotification('error', 'Passwords do not match.');
        return;
      }
      if (password.length < 6) {
        showNotification('error', 'Password must be at least 6 characters.');
        return;
      }

      setLoading(true);
      try {
        const apiBase = import.meta.env.VITE_API_URL || '';
        await axios.post(`${apiBase}/api/admin/register`, { email, password });
        showNotification('success', 'Registration successful! Please log in.');
        setTimeout(() => {
          setIsRegisterMode(false);
          setConfirmPassword('');
          setLoading(false);
        }, 1500);
      } catch (error) {
        console.error(error);
        const errorMsg = error.response?.data?.error || 'Registration failed. Please try again.';
        showNotification('error', errorMsg);
        setLoading(false);
      }
    } else {
      if (!email.trim() || !password.trim()) {
        showNotification('error', 'Please enter your email and password.');
        return;
      }

      setLoading(true);
      try {
        const apiBase = import.meta.env.VITE_API_URL || '';
        const response = await axios.post(`${apiBase}/api/admin/login`, { email, password });
        localStorage.setItem('adminToken', response.data.token);
        showNotification('success', 'Logged in successfully!');
        
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
    }
  };

  return (
    <div className="card-container fade-in" style={{ maxWidth: '440px' }}>
      <div className="card-header">
        <h2>{isRegisterMode ? 'Admin Registration' : 'Admin Authentication'}</h2>
        <p>
          {isRegisterMode 
            ? 'Create an administrator account to manage your isolated WhatsApp sessions and resources.' 
            : 'Sign in to access your document upload and WhatsApp linking portal.'}
        </p>
      </div>

      {notification && (
        <div className={`notification toast-${notification.type} slide-up`}>
          <span>{notification.message}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="form-layout">
        <div className="form-group">
          <label htmlFor="admin-email" className="form-label">Email Address</label>
          <input
            type="email"
            id="admin-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@school.edu"
            className="text-input"
            autoFocus
          />
        </div>

        <div className="form-group">
          <label htmlFor="admin-password" className="form-label">Password</label>
          <input
            type="password"
            id="admin-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••••"
            className="text-input"
          />
        </div>

        {isRegisterMode && (
          <div className="form-group">
            <label htmlFor="confirm-password" className="form-label">Confirm Password</label>
            <input
              type="password"
              id="confirm-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••••••"
              className="text-input"
            />
          </div>
        )}

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? (
            <div className="spinner-container">
              <span className="spinner"></span>
              {isRegisterMode ? 'Registering...' : 'Authenticating...'}
            </div>
          ) : (
            isRegisterMode ? 'Register Admin' : 'Access Portal'
          )}
        </button>
      </form>

      <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '0.88rem' }}>
        <span style={{ color: '#94a3b8' }}>
          {isRegisterMode ? 'Already have an account? ' : 'Need separate bot access? '}
        </span>
        <button 
          onClick={handleModeToggle}
          style={{
            background: 'none',
            border: 'none',
            color: '#3b82f6',
            fontWeight: '600',
            cursor: 'pointer',
            textDecoration: 'underline',
            fontFamily: 'inherit'
          }}
        >
          {isRegisterMode ? 'Sign In' : 'Register here'}
        </button>
      </div>
    </div>
  );
}
