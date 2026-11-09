import { useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import {
  LayoutDashboard, FileText, Package, Link2, BookOpen,
  ChevronLeft, LogOut, Building2, Settings,
  ShoppingCart, ClipboardList, Plus, PackageSearch, Lightbulb,
  WalletCards, SlidersHorizontal, BarChart3, Tags, FolderArchive,
  Truck,
} from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/contas-pagar', icon: FileText, label: 'Contas a Pagar' },
  { to: '/fornecedores', icon: Truck, label: 'Fornecedores' },
  { to: '/entradas', icon: Package, label: 'Entradas' },
  { to: '/cheques', icon: BookOpen, label: 'Cheques' },
  {
    to: '/compras',
    icon: ShoppingCart,
    label: 'Compras',
    children: [
      { to: '/compras/pedidos', icon: ClipboardList, label: 'Pedidos' },
      { to: '/compras/novo', icon: Plus, label: 'Novo pedido' },
      { to: '/compras/abertos', icon: ShoppingCart, label: 'Pedidos em aberto' },
      { to: '/compras/produtos-livres', icon: PackageSearch, label: 'Produtos livres' },
      { to: '/compras/sugestoes', icon: Lightbulb, label: 'Sugestoes de compra' },
      { to: '/compras/orcamento', icon: WalletCards, label: 'Orcamento de compras' },
      { to: '/compras/regras-estoque', icon: SlidersHorizontal, label: 'Regras de estoque' },
    ],
  },
  { to: '/ranking-vendas', icon: BarChart3, label: 'Ranking Vendas' },
  { to: '/vendas-analitico', icon: ClipboardList, label: 'Vendas Analítico' },
  { to: '/precos', icon: Tags, label: 'Precos' },
  { to: '/loja-info', icon: FolderArchive, label: 'Informações da Loja' },
  { to: '/vinculos', icon: Link2, label: 'Conciliacao DDA' },
  { to: '/config-bancaria', icon: Settings, label: 'Config. Bancária' },
];

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className={`flex flex-col bg-gray-900 text-white transition-all duration-200 ${collapsed ? 'w-16' : 'w-56'}`}>
        <div className="flex items-center gap-3 px-4 h-16 border-b border-white/10">
          <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center flex-shrink-0">
            <Building2 size={18} className="text-white" />
          </div>
          {!collapsed && <span className="font-bold text-sm tracking-tight">Admin Financeiro</span>}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`ml-auto p-1 rounded hover:bg-white/10 transition-transform ${collapsed ? 'rotate-180' : ''}`}
          >
            <ChevronLeft size={16} />
          </button>
        </div>

        <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
          {navItems.map(({ to, icon: Icon, label, children }) => {
            const parentActive = children && location.pathname.startsWith(to);

            if (children) {
              return (
                <div key={to}>
                  <NavLink
                    to={to}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                      parentActive
                        ? 'bg-brand-600 text-white font-medium'
                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <Icon size={18} className="flex-shrink-0" />
                    {!collapsed && <span>{label}</span>}
                  </NavLink>
                  {!collapsed && (
                    <div className="mt-1 ml-4 pl-3 border-l border-white/10 space-y-0.5">
                      {children.map(({ to: childTo, icon: ChildIcon, label: childLabel }) => (
                        <NavLink
                          key={childTo}
                          to={childTo}
                          className={({ isActive }) =>
                            `flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors ${
                              isActive
                                ? 'text-white bg-white/10'
                                : 'text-gray-500 hover:text-white hover:bg-white/5'
                            }`
                          }
                        >
                          <ChildIcon size={14} className="flex-shrink-0" />
                          <span>{childLabel}</span>
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-brand-600 text-white font-medium'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`
                }
              >
                <Icon size={18} className="flex-shrink-0" />
                {!collapsed && <span>{label}</span>}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-brand-600/30 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-brand-300">
                {user?.username?.charAt(0).toUpperCase() || 'A'}
              </span>
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white truncate">Administrador</p>
                <p className="text-xs text-gray-500 truncate">{user?.username}</p>
              </div>
            )}
            <button onClick={handleLogout} className="p-1.5 rounded hover:bg-white/10 text-gray-500 hover:text-white" title="Sair">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
