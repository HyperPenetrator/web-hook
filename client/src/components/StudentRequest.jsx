import React, { useState } from 'react';
import axios from 'axios';

export default function StudentRequest() {
  const [form, setForm] = useState({ name: '', phone: '', query: '' });
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState(null);
  const [success, setSuccess] = useState(false);

  const showNotification = (type, message) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 6000);
  };

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const { name, phone, query } = form;

    if (!name.trim() || !phone.trim() || !query.trim()) {
      showNotification('error', 'Please fill in all fields before submitting.');
      return;
    }

    // Basic phone sanity check — must be at least 7 digits
    const digitsOnly = phone.replace(/\D/g, '');
    if (digitsOnly.length < 7) {
      showNotification('error', 'Please enter a valid phone number with country code (e.g. 919876543210).');
      return;
    }

    setLoading(true);
    setSuccess(false);

    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      const response = await axios.post(`${apiBase}/api/request`, { name, phone: digitsOnly, query });
      const { message, matched_resource } = response.data;

      if (matched_resource) {
        setSuccess(true);
        showNotification('success', `✅ Found! "${matched_resource.fileName}" was sent to your WhatsApp.`);
        setForm({ name: '', phone: '', query: '' });
      } else {
        showNotification('info', message || 'No matching document found. Try a different search term.');
      }
    } catch (err) {
      const msg = err.response?.data?.error || 'Request failed. Please ensure the server is running.';
      showNotification('error', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card-container fade-in" style={{ maxWidth: '560px' }}>
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '1.8rem' }}>📱</span>
          <h2 style={{ margin: 0 }}>Request a Document</h2>
        </div>
        <p>
          Describe what you're looking for and we'll find the best matching document and
          send it directly to your WhatsApp.
        </p>
      </div>

      {/* Alternatively — tell users they can also just message the bot */}
      <div className="bot-hint">
        <span className="bot-hint-icon">💡</span>
        <span>
          You can also just <strong>message the bot directly on WhatsApp</strong> — type your
          request and it will auto-reply with the document!
        </span>
      </div>

      {notification && (
        <div className={`notification toast-${notification.type} slide-up`}>
          <span>{notification.message}</span>
        </div>
      )}

      {success && (
        <div className="success-banner slide-up">
          <div className="success-icon">✅</div>
          <div>
            <strong>Document sent!</strong>
            <p>Check your WhatsApp for the download link.</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="form-layout">
        {/* Name */}
        <div className="form-group">
          <label htmlFor="req-name" className="form-label">Your Name</label>
          <input
            id="req-name"
            type="text"
            name="name"
            value={form.name}
            onChange={handleChange}
            placeholder="e.g. Arjun Sharma"
            className="text-input"
            autoComplete="name"
          />
        </div>

        {/* Phone */}
        <div className="form-group">
          <label htmlFor="req-phone" className="form-label">WhatsApp Number</label>
          <input
            id="req-phone"
            type="tel"
            name="phone"
            value={form.phone}
            onChange={handleChange}
            placeholder="e.g. 919876543210 (include country code)"
            className="text-input"
            autoComplete="tel"
          />
          <small className="help-text">Include your country code without + (India: 91, US: 1)</small>
        </div>

        {/* Query */}
        <div className="form-group">
          <label htmlFor="req-query" className="form-label">What are you looking for?</label>
          <textarea
            id="req-query"
            name="query"
            value={form.query}
            onChange={handleChange}
            placeholder='e.g. "leave application form" or "semester exam schedule"'
            rows={3}
            className="textarea-input"
          />
          <small className="help-text">Describe naturally — our AI will match the closest document.</small>
        </div>

        <button
          type="submit"
          id="student-submit-btn"
          className="btn-primary"
          disabled={loading}
        >
          {loading ? (
            <div className="spinner-container">
              <span className="spinner"></span>
              Searching & Sending…
            </div>
          ) : (
            '🔍 Find & Send to WhatsApp'
          )}
        </button>
      </form>
    </div>
  );
}
