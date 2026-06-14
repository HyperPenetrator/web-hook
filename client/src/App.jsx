import React from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import AdminUpload from './components/AdminUpload';
import AdminLogin from './components/AdminLogin';
import StudentRequest from './components/StudentRequest';
import ProtectedRoute from './components/ProtectedRoute';
import './App.css';

function App() {
  return (
    <Router>
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <span className="logo-icon">⚡</span>
            <h1>EduHook Link</h1>
          </div>
          <nav className="nav-bar">
            <NavLink
              to="/student"
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              Student Portal
            </NavLink>
            <NavLink
              to="/admin"
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              Admin Portal
            </NavLink>
            <a
              href={`${import.meta.env.VITE_API_URL || ''}/console/sessions.html`}
              className="nav-link"
            >
              WhatsApp Link
            </a>
          </nav>
        </header>

        <main className="main-content">
          <Routes>
            <Route path="/" element={<Navigate to="/student" replace />} />
            <Route path="/student" element={<StudentRequest />} />
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route 
              path="/admin" 
              element={
                <ProtectedRoute>
                  <AdminUpload />
                </ProtectedRoute>
              } 
            />
            {/* Fallback redirect */}
            <Route path="*" element={<Navigate to="/student" replace />} />
          </Routes>
        </main>

        <footer className="app-footer">
          <p>© 2026 EduHook Link. AI-Powered Document Distribution.</p>
        </footer>
      </div>
    </Router>
  );
}

export default App;
