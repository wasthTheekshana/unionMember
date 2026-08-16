import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './styles.css';

function Placeholder({ text }) {
  return <div className="container"><div className="card">{text}</div></div>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Placeholder text="Login page coming in Task 10" />} />
        <Route path="/" element={<Placeholder text="Members list coming in Task 11" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
