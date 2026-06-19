'use client';

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import {
  DashboardData, UserRole,
  GerencialFilters, GerencialFilterOptions,
  ComercialFilters, ComercialFilterOptions,
} from '@/lib/types';
import { mockData } from '@/lib/mockData';
import { formatCOP, formatPct } from '@/lib/format';
import KPICard from './KPICard';
import GerencialFiltersPanel from './GerencialFilters';
import ComercialFiltersPanel from './ComercialFilters';
import SalesChart from './SalesChart';
import Alerts from './Alerts';
import InventoryTable from './InventoryTable';
import ClientsTable from './ClientsTable';
import ViewToggle from './ViewToggle';
import ChatBot from './ChatBot';
import DashboardSkeleton from './DashboardSkeleton';
import KPIDetailModal from './KPIDetailModal';
import ParetoChart from './ParetoChart';
import ProductDonutChart from './ProductDonutChart';
import AreaTrendChart from './AreaTrendChart';
import PerformanceHeatmap from './PerformanceHeatmap';
import Image from 'next/image';
import { TrendingUp, Package, RefreshCw, AlertCircle, ChevronRight, ChevronLeft, X } from 'lucide-react';

const emptyData: DashboardData = {
  kpis: mockData.kpis,
  ventasPorZona: [],
  ventasPorMes: [],
  ventasPorProducto: [],
  clientesPareto: [],
  clientesSinMovimiento: [],
  clientesNuevos: [],
  quejas: [],
  notasCredito: [],
  inventario: [],
  inventarioPorProducto: [],
  alertas: [],
  gastosPorZona: [],
  resumenMensual: [],
  reglasPromesa: [],
  otifCausalPorMes: [],
};

const emptyGerencialFilterOptions: GerencialFilterOptions = {
  sociedades: [], sbus: [], divisiones: [], periodos: [], consultores: [], clientes: [],
};
const defaultGerencialFilters: GerencialFilters = {
  sociedad: 'Alura', sbu: '', division: '', periodo: '', consultor: '', cliente: '',
};

const emptyComercialFilterOptions: ComercialFilterOptions = {
  sociedades: [], consultores: [], clientes: [], productos: [], divisiones: [], periodos: [],
};
const defaultComercialFilters: ComercialFilters = {
  sociedad: 'Alura', consultor: '', cliente: '', productos: [], division: '', periodo: '',
};

function mergeLiveData(live: Partial<DashboardData>): DashboardData {
  return {
    ...emptyData,
    ...live,
    kpis: { ...emptyData.kpis, ...(live.kpis ?? {}) },
  };
}

function buildGerencialQuery(f: GerencialFilters): string {
  const p = new URLSearchParams();
  if (f.sociedad)  p.set('sociedad',  f.sociedad);
  if (f.sbu)       p.set('sbu',       f.sbu);
  if (f.division)  p.set('division',  f.division);
  if (f.periodo)   p.set('periodo',   f.periodo);
  if (f.consultor) p.set('consultor', f.consultor);
  if (f.cliente)   p.set('cliente',   f.cliente);
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

export default function Dashboard({
  currentUserEmail,
  userRole = 'consultor',
}: {
  currentUserEmail?: string | null;
  userRole?: 'gerencial' | 'consultor';
}) {
  // Gerencial view filters (server-side)
  const [gerencialFilters, setGerencialFilters] = useState<GerencialFilters>(defaultGerencialFilters);
  const [gerencialFilterOptions, setGerencialFilterOptions] = useState<GerencialFilterOptions>(emptyGerencialFilterOptions);

  // Comercial view filters (server-side)
  const [comercialFilters, setComercialFilters] = useState<ComercialFilters>(defaultComercialFilters);
  const [comercialFilterOptions, setComercialFilterOptions] = useState<ComercialFilterOptions>(emptyComercialFilterOptions);

  const [currentView, setCurrentView] = useState<UserRole>(
    userRole === 'gerencial' ? 'gerencial' : 'consultor'
  );
  const [data, setData] = useState<DashboardData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [selectedKPI, setSelectedKPI] = useState<DashboardData['kpis']['ventaMes'] | null>(null);

  // Debounce gerencial filter changes so we don't fire on every keystroke
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gerencialFiltersRef = useRef(defaultGerencialFilters);
  const comercialFiltersRef = useRef(defaultComercialFilters);

  const redirectToLogin = useCallback(() => {
    if (typeof window === 'undefined') return;
    const nextPath = `${window.location.pathname}${window.location.search}`;
    window.location.href = `/login?next=${encodeURIComponent(nextPath)}`;
  }, []);

  const fetchGerencial = useCallback(async (f: GerencialFilters) => {
    setLoading(true);
    setError(null);
    try {
      const qs = buildGerencialQuery(f);
      const res = await fetch(`/api/data/gerencial${qs}`);
      if (res.status === 401 || res.status === 503) {
        redirectToLogin();
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const { filterOptions, ...live } = json;
      setData(mergeLiveData(live as Partial<DashboardData>));
      if (filterOptions) setGerencialFilterOptions(filterOptions);
      setLastUpdated(new Date());
    } catch {
      setError('No se pudieron cargar los datos del servidor.');
      setData(emptyData);
    } finally {
      setLoading(false);
    }
  }, [redirectToLogin]);

  const fetchComercial = useCallback(async (f: ComercialFilters) => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (f.sociedad)           p.set('sociedad',  f.sociedad);
      if (f.consultor)          p.set('consultor', f.consultor);
      if (f.cliente)            p.set('cliente',   f.cliente);
      if (f.division)           p.set('division',  f.division);
      if (f.periodo)            p.set('periodo',   f.periodo);
      f.productos?.forEach(pr => p.append('producto', pr));
      const qs = p.toString();
      const res = await fetch(`/api/data/comercial${qs ? `?${qs}` : ''}`);
      if (res.status === 401 || res.status === 503) {
        redirectToLogin();
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const { filterOptions, ...live } = json;
      setData(mergeLiveData(live as Partial<DashboardData>));
      if (filterOptions) setComercialFilterOptions(filterOptions);
      setLastUpdated(new Date());
    } catch {
      setError('No se pudieron cargar los datos del servidor.');
      setData(emptyData);
    } finally {
      setLoading(false);
    }
  }, [redirectToLogin]);

  const loadViewData = useCallback((view: UserRole) => {
    if (view === 'gerencial') {
      void fetchGerencial(gerencialFiltersRef.current);
      return;
    }

    void fetchComercial(comercialFiltersRef.current);
  }, [fetchComercial, fetchGerencial]);

  // Initial load
  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadViewData(currentView);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [currentView, loadViewData]);

  const handleGerencialFilterChange = useCallback((f: GerencialFilters) => {
    setGerencialFilters(f);
    gerencialFiltersRef.current = f;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchGerencial(f), 300);
  }, [fetchGerencial]);

  const handleComercialFilterChange = useCallback((f: ComercialFilters) => {
    setComercialFilters(f);
    comercialFiltersRef.current = f;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchComercial(f), 300);
  }, [fetchComercial]);

  const handleViewChange = (view: UserRole) => {
    setCurrentView(view);
    setGerencialFilters(defaultGerencialFilters);
    setComercialFilters(defaultComercialFilters);
    gerencialFiltersRef.current = defaultGerencialFilters;
    comercialFiltersRef.current = defaultComercialFilters;
  };

  const handleRefresh = () => {
    loadViewData(currentView);
  };

  // All filtering is server-side for both views — data is already filtered
  const ventasPorProductoDisplay = data.ventasPorProducto;
  const clientesParetoDisplay    = data.clientesPareto;
  const filteredAlertas          = data.alertas;

  const isFullYear = (currentView === 'gerencial' ? gerencialFilters.periodo : comercialFilters.periodo).endsWith('-all');
  const chartData  = isFullYear ? data.ventasPorMes : data.ventasPorZona;
  const chartTitle = isFullYear
    ? 'Venta mensual (año completo)'
    : currentView === 'consultor' ? 'Venta por Consultor' : 'Venta por Zona / Equipo';

  const renderMargen = (margen: number) => formatPct(margen);

  const buildKpiHistory = (metric: DashboardData['kpis']['ventaMes']) => {
    if (!data.resumenMensual || data.resumenMensual.length === 0) return undefined;
    if (metric.label.includes('Venta') || metric.label.includes('año')) return data.resumenMensual.map(i => ({ mes: i.mes, valor: i.ventaTotal }));
    if (metric.label.includes('Utilidad'))       return data.resumenMensual.map(i => ({ mes: i.mes, valor: i.utilidadBruta }));
    if (metric.label.includes('Margen') || metric.label.includes('Cumplimiento')) return data.resumenMensual.map(i => ({ mes: i.mes, valor: i.margenBruto }));
    if (metric.label === 'OTIF')                 return data.resumenMensual.map(i => ({ mes: i.mes, valor: i.otif }));
    if (metric.label.includes('sin movimiento')) return data.resumenMensual.map(i => ({ mes: i.mes, valor: i.clientesSinMovimiento }));
    if (metric.label.includes('nuevos'))         return data.resumenMensual.map(i => ({ mes: i.mes, valor: i.clientesNuevos }));
    if (metric.label === 'Quejas')               return data.resumenMensual.map(i => ({ mes: i.mes, valor: i.quejas }));
    if (metric.label.includes('crédito'))        return data.resumenMensual.map(i => ({ mes: i.mes, valor: i.notasCredito }));
    return undefined;
  };

  return (
    <div className="min-h-screen bg-[#EFF2F6]">
      <header className="bg-[#993935] border-b border-[#CCCCCC] sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Image
                src="https://latam.alura.bio/wp-content/uploads/2024/01/logo.svg"
                alt="Alura"
                width={100}
                height={35}
                className="h-7 w-auto brightness-0 invert flex-shrink-0"
              />
              <div className="hidden md:block border-l border-white/30 pl-3 ml-1">
                <h1 className="text-base font-bold text-white leading-tight">Dashboard Comercial CTC</h1>
                <p className="text-xs text-white/80">Iluma Alliance</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {lastUpdated && (
                <span className="text-xs text-white/70 hidden md:block">
                  Actualizado: {lastUpdated.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              {currentUserEmail && (
                <span className="hidden xl:inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white/90">
                  {currentUserEmail}
                </span>
              )}
              <button
                onClick={handleRefresh}
                disabled={loading}
                className="p-2 rounded-[6px] text-white/80 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
                title="Refrescar datos"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              {userRole === 'gerencial' ? (
                <ViewToggle currentView={currentView} onViewChange={handleViewChange} />
              ) : (
                <div className="flex items-center gap-2 bg-[#DBE2EB] rounded-[8px] px-4 py-2">
                  <span className="text-sm font-medium text-[#993935]">Vista Consultor</span>
                </div>
              )}
              {currentUserEmail && (
                <form action="/api/auth/logout" method="post">
                  <button
                    type="submit"
                    className="rounded-[6px] border border-white/20 px-3 py-2 text-xs font-medium text-white/90 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    Cerrar sesion
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </header>

      {loading && !error && <DashboardSkeleton />}

      {error && !loading && (
        <div className="max-w-7xl mx-auto px-4 pt-4">
          <div className="flex items-center gap-3 bg-[#FFA600]/10 border border-[#FFA600] rounded-[8px] px-4 py-3 text-sm text-[#6B4C00]">
            <AlertCircle className="w-4 h-4 flex-shrink-0 text-[#FFA600]" />
            {error}
            <button onClick={handleRefresh} className="ml-auto text-xs font-medium underline hover:no-underline">
              Reintentar
            </button>
          </div>
        </div>
      )}

      <main className={`max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6 ${loading ? 'hidden' : ''}`}>

        {/* Filters — different per view */}
        {currentView === 'gerencial' ? (
          <GerencialFiltersPanel
            filters={gerencialFilters}
            options={gerencialFilterOptions}
            onChange={handleGerencialFilterChange}
          />
        ) : (
          <ComercialFiltersPanel
            filters={comercialFilters}
            options={comercialFilterOptions}
            onChange={handleComercialFilterChange}
          />
        )}

        {currentView === 'consultor' && (
          <div className="flex items-start gap-2.5 bg-[#82BDFF]/10 border border-[#82BDFF]/40 rounded-[8px] px-4 py-3 text-sm text-[#2B2E35]">
            <svg className="w-4 h-4 mt-0.5 flex-shrink-0 text-[#3b82f6]" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
            </svg>
            <span>
              <strong className="font-semibold">Vista Comercial:</strong> muestra únicamente el portafolio gestionado por la fuerza de ventas directa (consultores asignados, Accuremax y equipos Porcicultura / Avicultura / Plantas ABA). Las ventas de aliados y canales indirectos no están incluidas.
            </span>
          </div>
        )}

        {/* KPIs — always reflect the currently fetched (filtered) data */}
        <section>
          <h2 className="text-lg font-bold text-[#2B2E35] mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-[#993935]" />
            KPIs Principales
          </h2>
          <KPIGrid
            kpis={data.kpis}
            alertas={filteredAlertas}
            currentView={currentView}
            onOpenAlerts={() => setAlertsOpen(true)}
            onKPIClick={setSelectedKPI}
          />
          {alertsOpen && (
            <AlertsModal alertas={filteredAlertas} onClose={() => setAlertsOpen(false)} />
          )}
        </section>

        {/* Row 1 — Main bar/line chart */}
        <SalesChart
          data={chartData}
          chartTitle={chartTitle}
          isMonthly={isFullYear}
        />

        {/* Row 2 — Monthly trend + Performance heatmap */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <AreaTrendChart
            data={data.resumenMensual}
            title="Tendencia mensual: Venta vs Presupuesto"
          />
          <PerformanceHeatmap
            data={data.ventasPorZona}
            title={currentView === 'consultor' ? 'Desempeño por Consultor' : 'Desempeño por Zona / Equipo'}
          />
        </div>

        {/* Row 3 — Pareto de clientes + Distribución de productos */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <ParetoChart
            data={clientesParetoDisplay}
            title="Pareto de Clientes (Top 10)"
          />
          <ProductDonutChart
            data={ventasPorProductoDisplay}
            title="Distribución de Ventas por Producto"
          />
        </div>

        {/* Row 4 — Products detail list */}
        {ventasPorProductoDisplay.length > 0 && (
          <div className="bg-white rounded-[12px] border border-[#DBE2EB] p-5 shadow-[0_4px_12px_rgba(0,0,0,0.10)]">
            <h3 className="text-sm font-bold text-[#2B2E35] mb-4 flex items-center gap-2">
              <Package className="w-4 h-4 text-[#993935]" />
              Detalle de Productos
            </h3>
            <div className="space-y-2">
              {ventasPorProductoDisplay.slice(0, 8).map((producto, index) => (
                <div key={index} className="flex items-center justify-between py-2 px-2 hover:bg-[#EFF2F6] rounded-[6px] transition-colors">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="text-xs font-bold text-[#8B8B8D] w-4 flex-shrink-0">{index + 1}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#2B2E35] truncate">{producto.producto}</p>
                      <p className="text-xs text-[#8B8B8D] truncate">{producto.presentacion || '—'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-bold text-[#2B2E35]">{formatCOP(producto.venta)}</p>
                      <p className={`text-xs ${producto.cumplimiento >= 100 ? 'text-[#27ae60]' : 'text-[#EB5852]'}`}>
                        {producto.cumplimiento > 0 ? formatPct(producto.cumplimiento) : '—'}
                      </p>
                    </div>
                    {currentView === 'gerencial' && producto.margen > 0 ? (
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-[6px] min-w-[52px] text-center ${
                        producto.categoria === 'A' ? 'bg-[#27ae60]/15 text-[#1a7a44]' :
                        producto.categoria === 'B' ? 'bg-[#82BDFF]/20 text-[#0066CC]' :
                        producto.categoria === 'C' ? 'bg-[#FFA600]/20 text-[#7a4d00]' :
                        'bg-[#EB5852]/15 text-[#9B2A1C]'
                      }`}>
                        {renderMargen(producto.margen)}
                      </span>
                    ) : (
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-[6px] min-w-[32px] text-center ${
                        producto.categoria === 'A' ? 'bg-[#27ae60]/15 text-[#1a7a44]' :
                        producto.categoria === 'B' ? 'bg-[#82BDFF]/20 text-[#0066CC]' :
                        producto.categoria === 'C' ? 'bg-[#FFA600]/20 text-[#7a4d00]' :
                        'bg-[#EB5852]/15 text-[#9B2A1C]'
                      }`}>
                        {producto.categoria}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {data.clientesSinMovimiento.length > 0 && (
          <ClientsTable
            tipo="sin-movimiento"
            clientes={data.clientesSinMovimiento}
          />
        )}

        {data.clientesNuevos.length > 0 && (
          <ClientsTable
            tipo="nuevos"
            clientes={data.clientesNuevos}
          />
        )}

        {data.inventario.length > 0 && (
          <InventoryTable inventario={data.inventario} />
        )}

        {currentView === 'gerencial' && data.gastosPorZona.length > 0 && (
          <div className="bg-white rounded-[12px] border border-[#DBE2EB] p-5 shadow-[0_4px_12px_rgba(0,0,0,0.10)]">
            <h3 className="text-sm font-bold text-[#2B2E35] mb-4">Gastos por Zona</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#DBE2EB]">
                    <th className="text-left py-2 px-2 font-medium text-[#6B7381]">Zona</th>
                    <th className="text-right py-2 px-2 font-medium text-[#6B7381]">Gasto</th>
                    <th className="text-right py-2 px-2 font-medium text-[#6B7381]">Presupuesto</th>
                    <th className="text-center py-2 px-2 font-medium text-[#6B7381]">Variación</th>
                  </tr>
                </thead>
                <tbody>
                  {data.gastosPorZona.map((gasto, index) => (
                    <tr key={index} className="border-b border-[#DBE2EB] hover:bg-[#EFF2F6]">
                      <td className="py-2 px-2 font-medium text-[#2B2E35]">{gasto.zona}</td>
                      <td className="py-2 px-2 text-right text-[#2B2E35]">{formatCOP(gasto.gasto)}</td>
                      <td className="py-2 px-2 text-right text-[#8B8B8D]">{formatCOP(gasto.presupuesto)}</td>
                      <td className="py-2 px-2 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          gasto.variacion > 0 ? 'bg-[#EB5852]/10 text-[#9B2A1C]' : 'bg-[#27ae60]/10 text-[#1a7a44]'
                        }`}>
                          {gasto.variacion > 0 ? '+' : ''}{formatPct(gasto.variacion)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </main>

      <KPIDetailModal
        metric={selectedKPI}
        onClose={() => setSelectedKPI(null)}
        historicalData={selectedKPI ? buildKpiHistory(selectedKPI) : undefined}
        otifCausalPorMes={selectedKPI?.label === 'OTIF' ? data.otifCausalPorMes : undefined}
      />

      <ChatBot data={loading ? null : data} view={currentView} />
    </div>
  );
}

function Alertas({ alertas }: { alertas: DashboardData['alertas'] }) {
  return <Alerts alertas={alertas} />;
}

function KPIGrid({
  kpis,
  alertas,
  currentView,
  onOpenAlerts,
  onKPIClick,
}: {
  kpis: DashboardData['kpis'];
  alertas: DashboardData['alertas'];
  currentView: UserRole;
  onOpenAlerts: () => void;
  onKPIClick: (metric: DashboardData['kpis']['ventaMes']) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const margenMetric = currentView === 'consultor'
    ? { ...kpis.margenBruto, label: 'Cumplimiento Ppto' }
    : kpis.margenBruto;

  const alertAccent: 'critical' | 'warning' | 'info' | undefined =
    alertas.some(a => a.nivel === 'critica') ? 'critical' :
    alertas.some(a => a.nivel === 'alta')    ? 'warning'  :
    alertas.length > 0                       ? 'info'     :
    undefined;

  const isGerencial = currentView === 'gerencial';

  return (
    <div className="flex items-stretch gap-2 sm:gap-3">
      <div className={`flex-1 grid gap-2 sm:gap-3 ${
        expanded
          ? 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-9'
          : isGerencial
            ? 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-7'
            : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'
      }`}>
        <KPICard metric={kpis.ventaMes} onClick={() => onKPIClick(kpis.ventaMes)} />
        {currentView === 'gerencial' && (
          <KPICard metric={kpis.utilidadBruta} onClick={() => onKPIClick(kpis.utilidadBruta)} />
        )}
        <KPICard metric={margenMetric} onClick={() => onKPIClick(margenMetric)} />
        <KPICard metric={kpis.otif} onClick={() => onKPIClick(kpis.otif)} />
        <KPICard metric={kpis.clientesSinMovimiento} onClick={() => onKPIClick(kpis.clientesSinMovimiento)} />
        <KPICard metric={kpis.clientesNuevos} onClick={() => onKPIClick(kpis.clientesNuevos)} />
        <KPICard metric={kpis.alertasInventario} onClick={onOpenAlerts} accent={alertAccent} />
        {expanded && (
          <Fragment>
            <KPICard metric={kpis.quejas} comingSoon />
            <KPICard metric={kpis.notasCredito} comingSoon />
          </Fragment>
        )}
      </div>

      <button
        onClick={() => setExpanded(v => !v)}
        title={expanded ? 'Ocultar Quejas y Notas crédito' : 'Ver Quejas y Notas crédito'}
        className="self-center flex-shrink-0 w-8 h-8 rounded-full bg-white border border-[#DBE2EB] flex items-center justify-center text-[#8B8B8D] hover:text-[#993935] hover:border-[#993935]/60 hover:bg-[#993935]/5 transition-colors shadow-sm"
      >
        {expanded ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>
    </div>
  );
}

function AlertsModal({
  alertas,
  onClose,
}: {
  alertas: DashboardData['alertas'];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-[12px] shadow-2xl border border-[#DBE2EB] w-full max-w-md max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#DBE2EB]">
          <h2 className="text-sm font-bold text-[#2B2E35]">Alertas activas</h2>
          <button
            onClick={onClose}
            className="text-[#8B8B8D] hover:text-[#2B2E35] transition-colors p-1 rounded-[6px] hover:bg-[#EFF2F6]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <Alertas alertas={alertas} />
        </div>
      </div>
    </div>
  );
}
