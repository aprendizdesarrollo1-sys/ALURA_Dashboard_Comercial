import type { RawRow } from './sheetsClient';
import type {
  DashboardData, KPIMetric, VentaPorZona, VentaPorProducto,
  ClientePareto, ClienteSinMovimiento, ClienteNuevo, ResumenMensual,
  ComercialFilters, ComercialFilterOptions,
} from './types';

const MESES_ORD: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12,
};
const MES_LABEL: Record<string, string> = {
  ene: 'Enero', feb: 'Febrero', mar: 'Marzo', abr: 'Abril',
  may: 'Mayo', jun: 'Junio', jul: 'Julio', ago: 'Agosto',
  sep: 'Septiembre', oct: 'Octubre', nov: 'Noviembre', dic: 'Diciembre',
};

type OrderedResumenMensual = ResumenMensual & { _ord: number };
type OrderedVentaPorZona = VentaPorZona & { _ord: number };

const EQUIPOS_VALIDOS = new Set(['Porcicultura', 'Avicultura', 'Plantas ABA']);
const SOCIEDADES_PERMITIDAS = new Set(['Alura', 'Alura Business']); // Solo estas sociedades

function n(v: unknown): number {
  const x = Number(v);
  return isNaN(x) ? 0 : x;
}

const money = (v: unknown) => n(v) * 1_000_000;

function kpi(label: string, value: number, prev: number, unit: KPIMetric['unit']): KPIMetric {
  return { label, value, previousValue: prev, unit };
}

function omitOrd<T extends { _ord: number }>(value: T): Omit<T, '_ord'> {
  const { _ord, ...rest } = value;
  void _ord;
  return rest;
}

function isComercial(r: RawRow): boolean {
  const consultor = String(r['Consultor_Cliente'] ?? '').trim();
  const producto  = String(r['Producto Único']    ?? '').trim();
  const equipo    = String(r['Equipo_Actual']      ?? '').trim();
  const sociedad  = String(r['Sociedad']           ?? '').trim();

  // Excluir explícitamente AFA y otras sociedades no permitidas
  if (sociedad && sociedad !== '-' && !SOCIEDADES_PERMITIDAS.has(sociedad)) {
    return false;
  }

  const tieneConsultor = consultor !== '' && consultor !== 'ALIADOS' && consultor !== '-';
  return tieneConsultor || producto === 'Accuremax' || EQUIPOS_VALIDOS.has(equipo);
}

// ── Build filter option lists from all comercial ERP rows ────────────────────
// When consultorFilter is provided, clientes and productos are scoped to that consultant.
export function buildComercialFilterOptions(rows: RawRow[], consultorFilter = ''): ComercialFilterOptions {
  const sociedades  = new Set<string>();
  const consultores = new Set<string>();
  const clientes    = new Set<string>();
  const productos   = new Set<string>();
  const divisiones  = new Set<string>();
  const periodos    = new Set<string>();

  // Filtrar primero solo los datos que son comerciales y de sociedades permitidas
  const rowesFiltrados = rows.filter(r => {
    if (r['Es_Ppto'] !== 'Es ERP') return false;
    if (!isComercial(r)) return false;
    const venta = money(r['Venta']);
    if (venta <= 0) return false;
    return true;
  });

  for (const r of rowesFiltrados) {
    const soc  = String(r['Sociedad']           ?? '').trim();
    const con  = String(r['Consultor_Cliente']  ?? '').trim();
    const cli  = String(r['Cliente']            ?? '').trim();
    const prod = String(r['Producto Único']     ?? '').trim();
    const div  = String(r['Division']           ?? '').trim();
    const mes  = String(r['Mes']                ?? '').toLowerCase().trim();
    const year = n(r['Año']);

    // Solo incluir sociedades permitidas (Alura SAS y Alura Business)
    if (soc  && soc  !== '-' && SOCIEDADES_PERMITIDAS.has(soc)) sociedades.add(soc);
    if (con  && con  !== '-' && con !== 'ALIADOS') consultores.add(con);
    if (div  && div  !== '-') divisiones.add(div);
    if (year > 2000 && mes) periodos.add(`${year}-${mes}`);

    // Scope clientes/productos to selected consultant
    if (consultorFilter && con !== consultorFilter) continue;
    if (cli)  clientes.add(cli);
    if (prod) productos.add(prod);
  }

  const sortedPeriodos = [...periodos].sort((a, b) => {
    const [ay, am] = a.split('-');
    const [by, bm] = b.split('-');
    const diff = Number(by) - Number(ay);
    return diff !== 0 ? diff : (MESES_ORD[bm] ?? 0) - (MESES_ORD[am] ?? 0);
  });

  return {
    sociedades:  [...sociedades].sort(),
    consultores: [...consultores].sort(),
    clientes:    [...clientes].sort(),
    productos:   [...productos].sort(),
    divisiones:  [...divisiones].sort(),
    periodos:    sortedPeriodos,
  };
}

function parsePeriodo(p: string): { year: number; mes: string } | null {
  const [y, m] = p.split('-');
  if (!y || !m) return null;
  return { year: Number(y), mes: m.toLowerCase() };
}

// ── Main transform ────────────────────────────────────────────────────────────
export function transformComercial(
  rows: RawRow[],
  filters?: Partial<ComercialFilters>
): Partial<DashboardData> {
  const fSociedad   = filters?.sociedad   || '';
  const fConsultor  = filters?.consultor  || '';
  const fCliente    = filters?.cliente    || '';
  const fProductos  = filters?.productos?.filter(Boolean) ?? [];
  const fDivision   = filters?.division   || '';
  const fPeriodo    = filters?.periodo    || '';

  const isAllYear = fPeriodo.endsWith('-all');
  const allYear   = isAllYear ? Number(fPeriodo.split('-')[0]) : 0;
  const periodoFilter = (!isAllYear && fPeriodo) ? parsePeriodo(fPeriodo) : null;

  // ── Split + comercial filter + period pre-filter ──────────────────────────
  const erp: RawRow[] = [];
  const pptoFiltered: RawRow[] = [];
  const yearSet = new Set<number>();

  for (const r of rows) {
    const y = n(r['Año']);
    const soc = String(r['Sociedad'] ?? '').trim();

    // Excluir AFA y otras sociedades no permitidas
    if (soc && soc !== '-' && !SOCIEDADES_PERMITIDAS.has(soc)) continue;

    if (r['Es_Ppto'] === 'Es ERP') {
      if (!isComercial(r)) continue;
      if (periodoFilter && y !== periodoFilter.year) continue;
      if (isAllYear     && y !== allYear)            continue;
      erp.push(r);
      if (y > 2000) yearSet.add(y);
    } else if (r['Es_Ppto'] === 'Es Ppto' && isComercial(r)) {
      pptoFiltered.push(r);
    }
  }

  // Apply sociedad + consultor + cliente + productos + division filters
  const erp2: RawRow[] = (fSociedad || fConsultor || fCliente || fProductos.length > 0 || fDivision) ? erp.filter(r => {
    if (fSociedad              && String(r['Sociedad']          ?? '').trim() !== fSociedad)                    return false;
    if (fConsultor             && String(r['Consultor_Cliente'] ?? '').trim() !== fConsultor)                   return false;
    if (fCliente               && String(r['Cliente']           ?? '').trim() !== fCliente)                     return false;
    if (fProductos.length > 0  && !fProductos.includes(String(r['Producto Único'] ?? '').trim()))               return false;
    if (fDivision              && String(r['Division']          ?? '').trim() !== fDivision)                    return false;
    return true;
  }) : erp;

  const years   = [...yearSet].sort((a, b) => b - a);
  const curYear = years[0] ?? new Date().getFullYear();
  const prevYear = years[1] ?? curYear - 1;

  // ── Pass 1: periods + monthly summary ────────────────────────────────────
  const periodSet   = new Set<number>();
  const mesVentaMap = new Map<string, { ord: number; ventaTotal: number }>();

  for (const r of erp2) {
    const year   = n(r['Año']);
    const venta  = money(r['Venta']);
    const period = n(r['Periodo']);
    const mes    = String(r['Mes']).toLowerCase();

    if (year === curYear && venta > 0) periodSet.add(period);

    if (year === curYear) {
      const label = MES_LABEL[mes] ?? mes;
      if (!mesVentaMap.has(label)) mesVentaMap.set(label, { ord: MESES_ORD[mes] ?? 99, ventaTotal: 0 });
      mesVentaMap.get(label)!.ventaTotal += venta;
    }
  }

  // Resolve which period is "current"
  let ultimoPeriodo: number;
  let penultimoPeriodo: number;

  if (isAllYear) {
    const periodosCur = [...periodSet].sort((a, b) => b - a);
    ultimoPeriodo    = periodosCur[0] ?? 0;
    penultimoPeriodo = 0;
  } else if (periodoFilter) {
    const matchSerial = erp2.find(
      r => n(r['Año']) === periodoFilter.year &&
           String(r['Mes']).toLowerCase() === periodoFilter.mes &&
           money(r['Venta']) > 0
    );
    ultimoPeriodo    = matchSerial ? n(matchSerial['Periodo']) : 0;
    penultimoPeriodo = 0;
  } else {
    const periodosCur = [...periodSet].sort((a, b) => b - a);
    ultimoPeriodo    = periodosCur[0] ?? 0;
    penultimoPeriodo = periodosCur[1] ?? 0;
  }

  const cutoff12m = ultimoPeriodo - 365;

  // ── Pass 2: cur/prev totals + consultor/prod/pareto/client maps ───────────
  let ventaCur = 0, ventaPrev = 0;
  const clientesUltimoMes      = new Set<string>();
  const clientesUltimos12Meses = new Set<string>();
  const clientesMesAnterior    = new Map<string, { zona: string; venta: number }>();
  let mesCur = '';
  const consultorMap    = new Map<string, { venta: number; ppto: number; clientes: Set<string> }>();
  const prodMap         = new Map<string, { venta: number; ppto: number; ub: number; material: string; segmento: string }>();
  const clienteVentaMap = new Map<string, { zona: string; venta: number; ub: number }>();

  for (const r of erp2) {
    const period  = n(r['Periodo']);
    const venta   = money(r['Venta']);
    const ub      = money(r['UB'] || 0);
    const cliente = String(r['Cliente']);
    const mes     = String(r['Mes'] ?? '').toLowerCase();

    const accumulate = () => {
      ventaCur += venta;
      if (venta > 0) clientesUltimoMes.add(cliente);
      if (!mesCur) mesCur = mes;

      const consultor = String(r['Consultor_Cliente'] || r['Consultor_Actual'] || '-');
      if (!consultorMap.has(consultor)) consultorMap.set(consultor, { venta: 0, ppto: 0, clientes: new Set() });
      const c = consultorMap.get(consultor)!;
      c.venta += venta;
      c.clientes.add(cliente);

      const prod = String(r['Producto Único'] || 'Otros');
      const seg  = String(r['Segmento_prod'] || '').trim();
      if (!prodMap.has(prod)) {
        prodMap.set(prod, { venta: 0, ppto: 0, ub: 0, material: String(r['Material'] || ''), segmento: seg });
      } else if (seg && !prodMap.get(prod)!.segmento) {
        prodMap.get(prod)!.segmento = seg;
      }
      prodMap.get(prod)!.venta += venta;
      prodMap.get(prod)!.ub += ub;

      if (venta > 0) {
        if (!clienteVentaMap.has(cliente)) clienteVentaMap.set(cliente, { zona: String(r['Consultor_Cliente'] || '-'), venta: 0, ub: 0 });
        clienteVentaMap.get(cliente)!.venta += venta;
        clienteVentaMap.get(cliente)!.ub += ub;
      }
    };

    if (isAllYear) {
      if (n(r['Año']) === allYear) accumulate();
    } else if (periodoFilter) {
      if (n(r['Año']) === periodoFilter.year && mes === periodoFilter.mes) accumulate();
    } else {
      if (period === ultimoPeriodo) {
        accumulate();
      } else if (period === penultimoPeriodo) {
        ventaPrev += venta;
        if (venta > 0) {
          const zona = String(r['Consultor_Cliente'] || r['Consultor_Actual'] || '-');
          if (!clientesMesAnterior.has(cliente)) clientesMesAnterior.set(cliente, { zona, venta: 0 });
          clientesMesAnterior.get(cliente)!.venta += venta;
        }
      } else if (period > cutoff12m && period < ultimoPeriodo && venta > 0) {
        clientesUltimos12Meses.add(cliente);
      }
    }
  }

  // ── Pass 3: ppto ─────────────────────────────────────────────────────────
  // Aplicar los mismos filtros que en erp2 para garantizar consistencia
  const ppto2: RawRow[] = (fSociedad || fConsultor || fCliente || fProductos.length > 0 || fDivision) ? pptoFiltered.filter(r => {
    if (fSociedad              && String(r['Sociedad']          ?? '').trim() !== fSociedad)                    return false;
    if (fConsultor             && String(r['Consultor_Cliente'] ?? '').trim() !== fConsultor)                   return false;
    if (fCliente               && String(r['Cliente']           ?? '').trim() !== fCliente)                     return false;
    if (fProductos.length > 0  && !fProductos.includes(String(r['Producto Único'] ?? '').trim()))               return false;
    if (fDivision              && String(r['Division']          ?? '').trim() !== fDivision)                    return false;
    return true;
  }) : pptoFiltered;

  let pptoCur = 0, pptoPrev = 0;
  const mesPptoMap = new Map<string, number>();

  for (const r of ppto2) {
    const year = n(r['Año']);
    const ppto = money(r['Ppto']);
    const mes  = String(r['Mes']).toLowerCase();

    const yearMatches = isAllYear ? year === allYear : year === curYear;
    if (yearMatches) {
      const label = MES_LABEL[mes] ?? mes;
      mesPptoMap.set(label, (mesPptoMap.get(label) ?? 0) + ppto);

      if (isAllYear || mes === mesCur) {
        pptoCur += ppto;

        const consultor = String(r['Consultor_Cliente'] || r['Consultor_Actual'] || '-');
        if (!consultorMap.has(consultor)) consultorMap.set(consultor, { venta: 0, ppto: 0, clientes: new Set() });
        consultorMap.get(consultor)!.ppto += ppto;

        const prod = String(r['Producto Único'] || 'Otros');
        if (!prodMap.has(prod)) prodMap.set(prod, { venta: 0, ppto: 0, ub: 0, material: String(r['Material'] || ''), segmento: '' });
        prodMap.get(prod)!.ppto += ppto;
      }
    } else if (year === prevYear && mes === mesCur) {
      pptoPrev += ppto;
    }
  }

  const cumplimientoCur  = pptoCur  > 0 ? (ventaCur  / pptoCur)  * 100 : 0;
  const cumplimientoPrev = pptoPrev > 0 ? (ventaPrev / pptoPrev) * 100 : 0;

  // ── Clientes sin movimiento ───────────────────────────────────────────────
  const sinMovimientoList = [...clientesMesAnterior.keys()].filter(c => !clientesUltimoMes.has(c));
  const refDate  = ultimoPeriodo    > 0 ? new Date((ultimoPeriodo    - 25569) * 86400 * 1000) : new Date();
  const prevDate = penultimoPeriodo > 0 ? new Date((penultimoPeriodo - 25569) * 86400 * 1000) : new Date();

  const clientesSinMovimiento: ClienteSinMovimiento[] = sinMovimientoList
    .map((c, i) => {
      const dias = Math.max(0, Math.round((refDate.getTime() - prevDate.getTime()) / 86400000));
      return {
        id: String(i + 1),
        nombre: c,
        zona: clientesMesAnterior.get(c)!.zona,
        diasSinCompra: dias,
        ultimaCompra: prevDate.toISOString().slice(0, 10),
        potencial: Math.round(clientesMesAnterior.get(c)!.venta),
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  // ── Clientes nuevos ───────────────────────────────────────────────────────
  const nuevos = [...clientesUltimoMes].filter(c => !clientesUltimos12Meses.has(c));

  const clientesNuevos: ClienteNuevo[] = nuevos.map((c, i) => ({
    id: String(i + 1),
    nombre: c,
    zona: clienteVentaMap.get(c)?.zona ?? '-',
    fechaCreacion: refDate.toISOString().slice(0, 10),
    primeraCompra: clienteVentaMap.get(c)?.venta ?? 0,
  })).sort((a, b) => b.primeraCompra - a.primeraCompra);

  // ── Output arrays ─────────────────────────────────────────────────────────
  const toCategoria = (segmento: string, cumplimiento: number): 'A' | 'B' | 'C' | 'D' => {
    const v = segmento.trim().toUpperCase();
    if (v === 'A' || v === 'B' || v === 'C' || v === 'D') return v as 'A' | 'B' | 'C' | 'D';
    // Fallback: derive from budget compliance when no Segmento_prod value
    if (cumplimiento >= 100) return 'A';
    if (cumplimiento >= 90)  return 'B';
    if (cumplimiento >= 75)  return 'C';
    return 'D';
  };

  const ventasPorZona: VentaPorZona[] = [...consultorMap.entries()]
    .map(([zona, z]) => ({
      zona,
      venta: z.venta,
      presupuesto: z.ppto,
      cumplimiento: z.ppto > 0 ? (z.venta / z.ppto) * 100 : 0,
      margen: 0,
      clientsCount: z.clientes.size,
    }))
    .filter(z => z.venta > 0 || z.presupuesto > 0)
    .sort((a, b) => b.venta - a.venta);

  const ventasPorProducto: VentaPorProducto[] = [...prodMap.entries()]
    .map(([producto, p]) => {
      const cumplimiento = p.ppto > 0 ? (p.venta / p.ppto) * 100 : 0;
      const margen = p.venta > 0 ? (p.ub / p.venta) * 100 : 0;
      return {
        producto,
        presentacion: p.material,
        venta: p.venta,
        presupuesto: p.ppto,
        cumplimiento,
        margen,
        categoria: toCategoria(p.segmento, cumplimiento),
      };
    })
    .filter(p => p.venta > 0 || p.presupuesto > 0)
    .sort((a, b) => b.venta - a.venta);

  const clientesPareto: ClientePareto[] = [...clienteVentaMap.entries()]
    .map(([nombre, c]) => ({
      nombre,
      zona: c.zona,
      venta: c.venta,
      porcentaje: ventaCur > 0 ? (c.venta / ventaCur) * 100 : 0,
      margen: c.venta > 0 ? (c.ub / c.venta) * 100 : 0,
      diasSinCompra: 0,
    }))
    .sort((a, b) => b.venta - a.venta)
    .slice(0, 20);

  const resumenMensual: ResumenMensual[] = [...new Set([...mesVentaMap.keys(), ...mesPptoMap.keys()])]
    .map(mes => {
      const v = mesVentaMap.get(mes) ?? { ord: 99, ventaTotal: 0 };
      return {
        mes,
        _ord: v.ord,
        ventaTotal: v.ventaTotal,
        ventaPresupuesto: mesPptoMap.get(mes) ?? 0,
        utilidadBruta: 0,
        utilidadBrutaPresupuesto: 0,
        margenBruto: 0,
        otif: 0, clientesNuevos: 0, clientesSinMovimiento: 0, quejas: 0, notasCredito: 0,
      } satisfies OrderedResumenMensual;
    })
    .sort((a, b) => a._ord - b._ord)
    .map(omitOrd);

  // ── ventasPorMes — for full-year chart (months as X-axis) ────────────────
  const ventasPorMes: VentaPorZona[] = [...new Set([...mesVentaMap.keys(), ...mesPptoMap.keys()])]
    .map(label => {
      const v    = mesVentaMap.get(label) ?? { ord: 99, ventaTotal: 0 };
      const ppto = mesPptoMap.get(label) ?? 0;
      const venta = v.ventaTotal;
      return {
        _ord: v.ord,
        zona: label,
        venta,
        presupuesto: ppto,
        cumplimiento: ppto > 0 ? (venta / ppto) * 100 : 0,
        margen: 0,
        clientsCount: 0,
      } satisfies OrderedVentaPorZona;
    })
    .sort((a, b) => a._ord - b._ord)
    .map(omitOrd);

  // ── Alerts — derived from same data as KPIs and chart ───────────────────
  const alertasFecha = refDate.toISOString().slice(0, 10);
  const alertas: DashboardData['alertas'] = [];
  let alertId = 0;

  for (const z of ventasPorZona) {
    if (z.presupuesto > 0 && z.cumplimiento < 80) {
      alertas.push({
        id: String(++alertId),
        tipo: 'otif',
        nivel: z.cumplimiento < 60 ? 'critica' : 'alta',
        titulo: `Consultor bajo presupuesto: ${z.zona}`,
        descripcion: `Cumplimiento del ${z.cumplimiento.toFixed(1)}% vs presupuesto.`,
        zona: z.zona,
        fecha: alertasFecha,
      });
    }
  }

  if (sinMovimientoList.length > 0) {
    alertas.push({
      id: String(++alertId),
      tipo: 'cliente',
      nivel: sinMovimientoList.length >= 5 ? 'alta' : 'media',
      titulo: 'Clientes sin movimiento',
      descripcion: `${sinMovimientoList.length} cliente(s) sin compra en el período actual.`,
      fecha: alertasFecha,
    });
  }

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpis: DashboardData['kpis'] = {
    ventaMes:              kpi(isAllYear ? 'Venta año' : 'Venta del mes',             ventaCur,                 pptoCur, 'currency'),
    utilidadBruta:         kpi('Utilidad bruta',                                       0,                        0,                'currency'),
    margenBruto:           kpi('Cumplimiento Ppto',                                    cumplimientoCur,          cumplimientoPrev, 'percentage'),
    otif:                  kpi('OTIF',                                                 82,                       80,               'percentage'),
    clientesSinMovimiento: kpi('Clientes sin movimiento (+30 días)',                   sinMovimientoList.length, 0,                'number'),
    clientesNuevos:        kpi('Clientes nuevos',                                      nuevos.length,            0,                'number'),
    quejas:                kpi('Quejas',                                               0,                        0,                'number'),
    notasCredito:          kpi('Notas crédito',                                        0,                        0,                'currency'),
    alertasInventario:     kpi('Alertas activas',                                      alertas.length,           0,                'number'),
  };

  return {
    kpis,
    ventasPorZona,
    ventasPorMes,
    ventasPorProducto,
    clientesPareto,
    clientesSinMovimiento,
    clientesNuevos,
    resumenMensual,
    quejas: [], notasCredito: [], alertas,
    gastosPorZona: [], inventario: [], inventarioPorProducto: [], reglasPromesa: [],
  };
}
