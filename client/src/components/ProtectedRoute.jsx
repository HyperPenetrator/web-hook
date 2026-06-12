import React from 'react';
import { Navigate } from 'react-router-dom';

/**
 * Route protection wrapper component.
 * Redirects to the admin login page if no JWT token is stored in localStorage.
 */
export default function ProtectedRoute({ children }) {
  const token = localStorage.getItem('adminToken');

  if (!token) {
    return <Navigate to="/admin/login" replace />;
  }

  return children;
}
