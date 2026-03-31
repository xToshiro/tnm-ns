import React, { useState, useMemo, useRef } from 'react';
import { Upload, Download, Activity, FileText, RefreshCcw, Info, AlertTriangle, CheckCircle, BarChart3, AlertOctagon } from 'lucide-react';

export default function App() {
  // Estado para controlar o sistema de unidades (Métrico vs Imperial)
  const [isMetric, setIsMetric] = useState(true);

  // Valores padrão (Baseados no caso da Av. Abolição)
  const defaultDataMetric = {
    v_m: 1318,       // Volume veicular (veh/h)
    N_th: 2,         // Faixas de rolamento
    S_R: 50,         // Velocidade de operação (km/h)
    L: 344.44,       // Extensão do trecho (m)
    W_T: 1.946,      // Largura Total da calçada (m)
    W_v: 3.65,       // Faixa externa (m)
    W_l: 3.05,       // Acostamento/Estacionamento (m)
    v_ped: 44,       // Fluxo de pedestres (ped/h)
    W_si: 0.457,     // Shy distance lado rua (m) -> aprox 1.5 ft
    W_so: 0.457,     // Shy distance lado lote (m) -> aprox 1.5 ft
    d_px: 60,        // Atraso de travessia na via (s)
    C: 104,          // Ciclo (s)
    g_walk: 56,      // Verde de pedestre (s)
    N_d: 2           // Faixas transversais
  };

  const [formData, setFormData] = useState({ ...defaultDataMetric });
  const fileInputRef = useRef(null);

  // Manipulador de formulário
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: parseFloat(value) || 0
    }));
  };

  // Alternar sistema de unidades e converter os dados atuais no formulário
  const toggleUnitSystem = () => {
    setFormData(prev => {
      const converted = { ...prev };
      const factorDist = isMetric ? 3.28084 : (1 / 3.28084); // m <-> ft
      const factorSpeed = isMetric ? (1 / 1.60934) : 1.60934; // km/h <-> mph

      converted.L = parseFloat((prev.L * factorDist).toFixed(3));
      converted.W_T = parseFloat((prev.W_T * factorDist).toFixed(3));
      converted.W_v = parseFloat((prev.W_v * factorDist).toFixed(3));
      converted.W_l = parseFloat((prev.W_l * factorDist).toFixed(3));
      converted.W_si = parseFloat((prev.W_si * factorDist).toFixed(3));
      converted.W_so = parseFloat((prev.W_so * factorDist).toFixed(3));
      converted.S_R = parseFloat((prev.S_R * factorSpeed).toFixed(2));

      return converted;
    });
    setIsMetric(!isMetric);
  };

  // Reseta para o padrão
  const resetToDefault = () => {
    setIsMetric(true);
    setFormData({ ...defaultDataMetric });
  };

  // Motor de Cálculo HCM 2016
  const results = useMemo(() => {
    // 1. Conversão interna forçada para US Customary Units para as fórmulas
    const fDist = isMetric ? 3.28084 : 1;
    const fSpd = isMetric ? (1 / 1.60934) : 1;

    const L_ft = formData.L * fDist;
    const WT_ft = formData.W_T * fDist;
    const Wv_ft = formData.W_v * fDist;
    const Wl_ft = formData.W_l * fDist;
    const Wsi_ft = formData.W_si * fDist;
    const Wso_ft = formData.W_so * fDist;
    const SR_mph = formData.S_R * fSpd;

    // Passo 1: Velocidade de Fluxo Livre (Spf)
    const S_pf = 4.4; // ft/s

    // Passo 2: Espaço Médio
    let W_E = WT_ft - Wsi_ft - Wso_ft;
    if (W_E <= 0) W_E = 0.1; // Previne divisão por zero

    const v_p = formData.v_ped / (60 * W_E);
    const A_p = v_p > 0 ? (60 * S_pf) / v_p : 9999; // Se não tem pedestre, espaço é infinito

    // Passo 3: Atraso Interseção
    const d_pp = Math.pow((formData.C - formData.g_walk), 2) / (2 * formData.C);

    // Passo 4: Velocidade Viagem Pedestre
    const S_Tp_seg = L_ft / ((L_ft / S_pf) + d_pp);

    // Passo 5: Score Interseção (I_p,int)
    const F_w_int = 0.681 * Math.pow(formData.N_d, 0.514);
    const F_delay_int = 0.0401 * Math.log(Math.max(d_pp, 0.001));
    const I_p_int = 0.5997 + F_w_int + 0.07 + F_delay_int; // F_s=0.07, F_v=0 (Simplificado)

    // Passo 6: Score Link (I_p,link)
    const W_aA = Math.min(WT_ft, 10);
    const f_sw = 6.0 - 0.3 * W_aA;
    const paramInLn = Wv_ft + 0.5 * Wl_ft + W_aA * f_sw;
    const F_w_link = -1.2276 * Math.log(Math.max(paramInLn, 1));
    const F_v_link = 0.0091 * (formData.v_m / (4 * Math.max(formData.N_th, 1)));
    const F_s_link = 4 * Math.pow(SR_mph / 100, 2);
    const I_p_link = 6.0468 + F_w_link + F_v_link + F_s_link;

    // Passo 8: Dificuldade de Travessia
    const d_px_limited = Math.min(formData.d_px, 60);
    let F_cd = 1.0 + (0.10 * d_px_limited - (0.318 * I_p_link + 0.220 * I_p_int + 1.606)) / 7.5;
    F_cd = Math.max(0.80, Math.min(1.20, F_cd)); // Teto e piso HCM

    // Passo 9: Score Segmento Final
    const I_p_seg = 0.75 * (F_cd * I_p_link) + 0.25 * I_p_int;

    // Passo 10 e Determinação de Nível de Serviço (LOS)
    const getLOS = (score) => {
      if (score <= 2.00) return { letter: 'A', color: '#16a34a', bg: 'bg-green-600', text: 'text-green-600' };
      if (score <= 2.75) return { letter: 'B', color: '#84cc16', bg: 'bg-lime-500', text: 'text-lime-600' };
      if (score <= 3.50) return { letter: 'C', color: '#eab308', bg: 'bg-yellow-500', text: 'text-yellow-600' };
      if (score <= 4.25) return { letter: 'D', color: '#f97316', bg: 'bg-orange-500', text: 'text-orange-600' };
      if (score <= 5.00) return { letter: 'E', color: '#ef4444', bg: 'bg-red-500', text: 'text-red-600' };
      return { letter: 'F', color: '#991b1b', bg: 'bg-red-800', text: 'text-red-800' };
    };

    const losLink = getLOS(I_p_link);
    const losSeg = getLOS(I_p_seg);

    // Geração Automática de Insights (Pontos Críticos)
    const insights = [];

    // Análise de Volume
    if ((formData.v_m / Math.max(formData.N_th, 1)) > 500) {
      insights.push({ type: 'warning', text: `Alto volume veicular (${formData.v_m} v/h). O barulho e a proximidade reduzem drasticamente o conforto na calçada.` });
    }

    // Análise de Velocidade
    if (SR_mph > 30) { // aprox 48 km/h
      insights.push({ type: 'warning', text: `Velocidade operacional elevada (${isMetric ? (SR_mph * 1.609).toFixed(0) + ' km/h' : SR_mph.toFixed(0) + ' mph'}). Aumenta a percepção de risco.` });
    }

    // Análise de Largura
    if (W_E < 4) { // Menor que ~1.2m livres
      insights.push({ type: 'critical', text: `Largura livre muito estreita (${isMetric ? (W_E / 3.281).toFixed(2) + ' m' : W_E.toFixed(2) + ' ft'}). Obstáculos e "shy distances" estão asfixiando a calçada.` });
    } else {
      insights.push({ type: 'success', text: 'A calçada possui uma boa largura efetiva livre para o trânsito de pedestres.' });
    }

    // Análise de Travessia (Dificuldade)
    if (F_cd >= 1.15) {
      insights.push({ type: 'critical', text: 'Extrema dificuldade de travessia a meio de quadra. Pedestres sentem-se isolados neste lado da via.' });
    }

    // Análise de Interseção
    if (d_pp > 30) {
      insights.push({ type: 'warning', text: `Longo tempo de espera no semáforo (${d_pp.toFixed(0)}s). Alta probabilidade de travessia arriscada no vermelho.` });
    }

    return {
      S_pf, W_E, A_p, d_pp, S_Tp_seg, I_p_int, I_p_link, F_cd, I_p_seg, losLink, losSeg,
      F_w_link, F_v_link, F_s_link, insights
    };
  }, [formData, isMetric]);


  // Manipulação de Arquivos TXT
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const lines = text.split('\n');
      const newData = { ...formData };

      lines.forEach(line => {
        const [key, val] = line.split('=');
        if (key && val) {
          const cleanKey = key.trim();
          if (newData[cleanKey] !== undefined) {
            newData[cleanKey] = parseFloat(val.trim());
          }
        }
      });
      setFormData(newData);
    };
    reader.readAsText(file);
    e.target.value = null; // reset
  };

  const generateTemplateTXT = () => {
    let content = `# Template de Importação - Calculadora LOS HCM 2016\n`;
    content += `# Sistema Atual: ${isMetric ? 'Métrico (m, km/h)' : 'Imperial (ft, mph)'}\n`;
    Object.entries(formData).forEach(([key, value]) => {
      content += `${key}=${value}\n`;
    });
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "dados_los_pedestres.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 font-sans">
      {/* Barra de Atividade Acadêmica */}
      <div className="bg-blue-800 text-white py-2 px-4 shadow-md">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row justify-between items-center text-xs sm:text-sm font-medium">
          <span>🎓Transporte Não Motorizado</span>
          <span className="mt-1 sm:mt-0 opacity-90">Criadores: Jairo Ivo e Ana Flávia</span>
        </div>
      </div>

      <div className="p-4 md:p-8">
        {/* Header */}
        <header className="max-w-6xl mx-auto mb-8 bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Activity className="text-blue-600" />
              HCM 2016: Avaliação de LOS de Pedestres
            </h1>
            <p className="text-sm text-gray-500 mt-1">Ferramenta metodológica p/ Segmentos Urbanos (Capítulos 18 e 19)</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button onClick={toggleUnitSystem} className="px-4 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors flex items-center gap-2">
              <RefreshCcw size={16} />
              {isMetric ? 'Usando: Métrico (m, km/h)' : 'Usando: Imperial (ft, mph)'}
            </button>

            <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 text-sm font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors flex items-center gap-2">
              <Upload size={16} /> Importar TXT
            </button>
            <input type="file" accept=".txt" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />

            <button onClick={generateTemplateTXT} className="px-4 py-2 text-sm font-medium bg-gray-800 text-white hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-2">
              <Download size={16} /> Template
            </button>
          </div>
        </header>

        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">

          {/* Lado Esquerdo - Entradas */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
              <h2 className="text-lg font-bold border-b pb-2 mb-4">Tráfego Motorizado Adjacente</h2>
              <div className="space-y-3">
                <InputRow label="Volume Veicular (veh/h)" name="v_m" value={formData.v_m} onChange={handleChange} />
                <InputRow label="Qtd. de Faixas de Rolamento" name="N_th" value={formData.N_th} onChange={handleChange} />
                <InputRow label={`Velocidade de Operação (${isMetric ? 'km/h' : 'mph'})`} name="S_R" value={formData.S_R} onChange={handleChange} />
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
              <h2 className="text-lg font-bold border-b pb-2 mb-4">Geometria da Via e Calçada</h2>
              <div className="space-y-3">
                <InputRow label={`Extensão do Segmento (${isMetric ? 'm' : 'ft'})`} name="L" value={formData.L} onChange={handleChange} />
                <InputRow label={`Largura Total Calçada (${isMetric ? 'm' : 'ft'})`} name="W_T" value={formData.W_T} onChange={handleChange} />
                <InputRow label={`Faixa Externa Efetiva (${isMetric ? 'm' : 'ft'})`} name="W_v" value={formData.W_v} onChange={handleChange} />
                <InputRow label={`Largura Acostamento/Estac. (${isMetric ? 'm' : 'ft'})`} name="W_l" value={formData.W_l} onChange={handleChange} />
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
              <h2 className="text-lg font-bold border-b pb-2 mb-4">Características de Pedestres</h2>
              <div className="space-y-3">
                <InputRow label="Fluxo de Pedestres (ped/h)" name="v_ped" value={formData.v_ped} onChange={handleChange} />
                <InputRow label={`Shy Dist. Lado Rua (${isMetric ? 'm' : 'ft'})`} name="W_si" value={formData.W_si} onChange={handleChange} />
                <InputRow label={`Shy Dist. Lado Lote (${isMetric ? 'm' : 'ft'})`} name="W_so" value={formData.W_so} onChange={handleChange} />
                <InputRow label="Atraso Travessia Via (s)" name="d_px" value={formData.d_px} onChange={handleChange} />
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
              <h2 className="text-lg font-bold border-b pb-2 mb-4">Interseção de Jusante</h2>
              <div className="space-y-3">
                <InputRow label="Tempo de Ciclo (s)" name="C" value={formData.C} onChange={handleChange} />
                <InputRow label="Verde p/ Pedestres (s)" name="g_walk" value={formData.g_walk} onChange={handleChange} />
                <InputRow label="Faixas da Transversal Cruzada" name="N_d" value={formData.N_d} onChange={handleChange} />
              </div>
            </div>

            <button onClick={resetToDefault} className="w-full py-3 text-sm font-bold text-gray-500 hover:text-gray-800 transition-colors">
              Restaurar Dados do Exemplo (Av. Abolição)
            </button>
          </div>

          {/* Lado Direito - Resultados */}
          <div className="lg:col-span-8 flex flex-col gap-6">

            {/* Painel Principal de LOS */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row gap-6 items-center">
              <div className={`w-32 h-32 rounded-2xl flex items-center justify-center text-5xl font-black text-white shadow-inner ${results.losSeg.bg}`}>
                {results.losSeg.letter}
              </div>
              <div className="flex-1">
                <h2 className="text-2xl font-bold text-gray-800">Nível de Serviço do Segmento</h2>
                <p className="text-gray-500 mt-1 mb-4">Resultado consolidado com base na dificuldade de travessia e interação nas extremidades.</p>
                <div className="flex flex-wrap gap-4">
                  <div className="bg-gray-50 px-4 py-2 rounded-lg border border-gray-100">
                    <span className="text-xs text-gray-500 uppercase font-semibold">Score Segmento (I_p,seg)</span>
                    <div className={`text-xl font-bold ${results.losSeg.text}`}>{results.I_p_seg.toFixed(3)}</div>
                  </div>
                  <div className="bg-gray-50 px-4 py-2 rounded-lg border border-gray-100">
                    <span className="text-xs text-gray-500 uppercase font-semibold">Score Apenas Link (I_p,link)</span>
                    <div className={`text-xl font-bold ${results.losLink.text}`}>{results.I_p_link.toFixed(3)}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* NOVA SEÇÃO: Estatísticas e Pontos Críticos */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

              {/* Gráfico Analítico de Penalidades (Fatores do HCM) */}
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h3 className="font-bold text-gray-800 flex items-center gap-2 mb-4 border-b pb-2">
                  <BarChart3 size={18} className="text-blue-600" /> Impacto dos Fatores (Link)
                </h3>
                <p className="text-xs text-gray-500 mb-4">Quanto maior a barra, pior é o impacto daquele fator na percepção de conforto (aumenta o score).</p>

                <div className="space-y-4">
                  <FactorBar
                    label="Penalidade por Volume (F_v)"
                    value={results.F_v_link}
                    max={3}
                    color="bg-red-500"
                  />
                  <FactorBar
                    label="Penalidade por Velocidade (F_s)"
                    value={results.F_s_link}
                    max={2}
                    color="bg-orange-500"
                  />
                  {/* O fator W é negativo geralmente (abate a nota base). Exibimos de forma invertida para entendimento didático */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-gray-700">Abatimento por Afastamento/Largura (F_w)</span>
                      <span className="text-gray-900">{results.F_w_link.toFixed(2)} pts</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden flex justify-end">
                      <div className="bg-green-500 h-2.5 rounded-full" style={{ width: `${Math.min(100, Math.abs(results.F_w_link) * 20)}%` }}></div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Diagnóstico Automatizado (Insights) */}
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h3 className="font-bold text-gray-800 flex items-center gap-2 mb-4 border-b pb-2">
                  <AlertOctagon size={18} className="text-blue-600" /> Análise de Pontos Críticos
                </h3>

                <div className="space-y-3 overflow-y-auto max-h-48 pr-2">
                  {results.insights.map((insight, idx) => (
                    <div key={idx} className={`p-3 rounded-lg flex items-start gap-3 border ${insight.type === 'critical' ? 'bg-red-50 border-red-200 text-red-800' :
                      insight.type === 'warning' ? 'bg-orange-50 border-orange-200 text-orange-800' :
                        'bg-green-50 border-green-200 text-green-800'
                      }`}>
                      {insight.type === 'critical' && <AlertOctagon size={16} className="mt-0.5 flex-shrink-0" />}
                      {insight.type === 'warning' && <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />}
                      {insight.type === 'success' && <CheckCircle size={16} className="mt-0.5 flex-shrink-0" />}
                      <p className="text-xs font-medium leading-relaxed">{insight.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Representação Visual da Via */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <h3 className="font-bold text-gray-800 flex items-center gap-2 mb-4">
                <FileText size={18} /> Representação Visual da Via
              </h3>

              <div className="relative w-full h-40 bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
                {/* Lotes topo */}
                <div className="absolute top-0 w-full h-6 bg-gray-300 flex items-center px-4">
                  <span className="text-xs font-bold text-gray-500">LOTES / MUROS</span>
                </div>

                {/* Calçada Estudada */}
                <div className="absolute top-6 w-full h-10 flex items-center justify-center transition-colors duration-500" style={{ backgroundColor: results.losSeg.color }}>
                  <span className="text-sm font-bold text-white tracking-widest bg-black/20 px-3 py-1 rounded shadow-sm">CALÇADA AVALIADA (LOS {results.losSeg.letter})</span>
                </div>

                {/* Via Veicular */}
                <div className="absolute top-16 w-full h-16 bg-gray-700 flex flex-col justify-center">
                  <div className="w-full h-0 border-t-4 border-dashed border-white opacity-50"></div>
                  <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
                    <span className="text-white text-xs font-bold bg-black/40 px-2 py-1 rounded">Fluxo Veicular: {formData.v_m} v/h</span>
                    <span className="text-white text-xs">&#8592;</span>
                  </div>
                </div>

                {/* Calçada Oposta */}
                <div className="absolute bottom-0 w-full h-8 bg-gray-300 flex items-center justify-center">
                  <span className="text-xs font-bold text-gray-500">CALÇADA OPOSTA</span>
                </div>
              </div>
            </div>

            {/* Tabela Passo a Passo (Transparência HCM) */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <h3 className="font-bold text-gray-800 mb-4 border-b pb-2">Memória de Cálculo (Passo a Passo HCM 2016)</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 text-sm">
                <StepRow step="1" title="Velocidade Fluxo Livre (S_pf)" value={`${results.S_pf.toFixed(2)} ft/s`} />
                <StepRow step="2" title="Largura Efetiva Calçada (W_E)" value={`${results.W_E.toFixed(2)} ft`} />
                <StepRow step="2" title="Espaço Médio Pedestre (A_p)" value={results.A_p > 1000 ? '> 1000 ft²/p' : `${results.A_p.toFixed(2)} ft²/p`} highlight={results.A_p > 60 ? 'LOS A (Espaço)' : ''} />
                <StepRow step="3" title="Atraso na Interseção (d_pp)" value={`${results.d_pp.toFixed(2)} s/ped`} />
                <StepRow step="4" title="Velocidade Viagem (S_Tp,seg)" value={`${results.S_Tp_seg.toFixed(2)} ft/s`} />
                <StepRow step="5" title="Score Interseção (I_p,int)" value={results.I_p_int.toFixed(3)} />
                <StepRow step="6" title="Score Link (I_p,link)" value={results.I_p_link.toFixed(3)} />
                <StepRow step="8" title="Fator Dif. Travessia (F_cd)" value={results.F_cd.toFixed(3)} />
                <StepRow step="9" title="Score Segmento (I_p,seg)" value={results.I_p_seg.toFixed(3)} />
              </div>

              <div className="mt-6 bg-blue-50 p-4 rounded-lg flex items-start gap-3 text-blue-800 text-sm">
                <Info className="flex-shrink-0 mt-0.5" size={16} />
                <p>O método HCM 2016 calcula o Nível de Serviço do Pedestre determinando primeiramente o <strong>Espaço Físico (Passo 2)</strong> e depois a percepção de <strong>Conforto / Segurança (Passo 9)</strong>. O LOS Final reflete a restrição mais severa entre essas duas avaliações.</p>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

// Subcomponente de Input
const InputRow = ({ label, name, value, onChange }) => (
  <div className="flex flex-col">
    <label className="text-xs font-semibold text-gray-600 mb-1">{label}</label>
    <input
      type="number"
      step="any"
      name={name}
      value={value}
      onChange={onChange}
      className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
    />
  </div>
);

// Subcomponente de Linha de Resultado
const StepRow = ({ step, title, value, highlight }) => (
  <div className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
    <div className="flex items-center gap-2">
      <span className="bg-gray-800 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full">P{step}</span>
      <span className="text-gray-600">{title}</span>
    </div>
    <div className="text-right">
      <span className="font-mono font-bold text-gray-900">{value}</span>
      {highlight && <span className="ml-2 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold">{highlight}</span>}
    </div>
  </div>
);

// Subcomponente de Barra Gráfica de Fatores
const FactorBar = ({ label, value, max, color }) => {
  // Calcula porcentagem baseada no máximo esperado para visualização adequada
  const percentage = Math.min(100, (value / max) * 100);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs font-semibold">
        <span className="text-gray-700">{label}</span>
        <span className="text-gray-900">+{value.toFixed(2)} pts</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
        <div className={`${color} h-2.5 rounded-full transition-all duration-500`} style={{ width: `${percentage}%` }}></div>
      </div>
    </div>
  );
};