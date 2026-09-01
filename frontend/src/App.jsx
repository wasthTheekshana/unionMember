import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './routes/ProtectedRoute';
import Login from './pages/Login';
import MembersList from './pages/MembersList';
import MemberForm from './pages/MemberForm';
import './styles.css';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedRoute><MembersList /></ProtectedRoute>} />
          <Route path="/members/new" element={<ProtectedRoute><MemberForm /></ProtectedRoute>} />
          <Route path="/members/:id/edit" element={<ProtectedRoute><MemberForm /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
