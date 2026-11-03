import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { Toaster } from 'react-hot-toast';
import AppLayout from './components/layout/AppLayout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ContasPagarPage from './pages/ContasPagarPage';
import EntradasPage from './pages/EntradasPage';
import ChequesPage from './pages/ChequesPage';
import VinculosPage from './pages/VinculosPage';
import ConfigBancariaPage from './pages/ConfigBancariaPage';
import ComprasPage from './pages/ComprasPage';
import RankingVendasPage from './pages/RankingVendasPage';
import VendasAnaliticoPage from './pages/VendasAnaliticoPage';
import PrecosPage from './pages/PrecosPage';
import LojaInfoPage from './pages/LojaInfoPage';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Carregando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Toaster position="top-right" toastOptions={{ duration: 3000, style: { fontSize: '14px' } }} />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
            <Route index element={<DashboardPage />} />
            <Route path="contas-pagar" element={<ContasPagarPage />} />
            <Route path="entradas" element={<EntradasPage />} />
            <Route path="cheques" element={<ChequesPage />} />
            <Route path="compras/*" element={<ComprasPage />} />
            <Route path="ranking-vendas" element={<RankingVendasPage />} />
            <Route path="vendas-analitico" element={<VendasAnaliticoPage />} />
            <Route path="precos" element={<PrecosPage />} />
            <Route path="loja-info" element={<LojaInfoPage />} />
            <Route path="vinculos" element={<VinculosPage />} />
            <Route path="config-bancaria" element={<ConfigBancariaPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
