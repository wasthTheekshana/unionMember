import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './routes/ProtectedRoute';
import Login from './pages/Login';
import MembersList from './pages/MembersList';
import './styles.css';

function Placeholder({ text }) {
  return <div className="container"><div className="card">{text}</div></div>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedRoute><MembersList /></ProtectedRoute>} />
          <Route path="/members/new" element={<Placeholder text="Add member form coming in Task 12" />} />
          <Route path="/members/:id/edit" element={<Placeholder text="Edit member form coming in Task 12" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
