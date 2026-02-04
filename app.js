import { Network } from "https://unpkg.com/vis-network/standalone/esm/vis-network.min.js";

let SCENARIOS = [];
let network = null;
let currentScenario = null;
let currentLens = 'fraud';
let graphData = { nodes: [], edges: [], nodeById: {}, edgesRaw: [] };
let lastNodeExplanation = '';

async function loadScenarios() {
  const res = await fetch('scenarios.json');
  SCENARIOS = await res.json();
}

function getScenarioById(id) {
  return SCENARIOS.find(s => s.id === id);
}

function nodeColorForType(type) {
  switch (type) {
    case 'seller': return '#0ea5e9';
    case 'buyer': return '#22c55e';
    case 'bank': return '#f97373';
    case 'device': return '#a855f7';
    case 'card': return '#facc15';
    case 'dispute': return '#fb923c';
    default: return '#e5e7eb';
  }
}

function nodeTypePill(type) {
  const map = {
    seller: 'pill-seller',
    buyer: 'pill-buyer',
    bank: 'pill-bank',
    device: 'pill-device',
    card: 'pill-card',
    dispute: 'pill-dispute'
  };
  const cls = map[type] || 'pill-other';
  return `<span class="pill-type ${cls}">${type}</span>`;
}

function edgeLabel(type) {
  switch (type) {
    case 'order': return 'ORDER';
    case 'payout': return 'PAYOUT';
    case 'uses_device': return 'USES DEVICE';
    case 'uses_card': return 'USES CARD';
    case 'controls': return 'CONTROLS';
    default: return type.toUpperCase();
  }
}

function buildGraphFromScenario(scenario) {
  const nodes = scenario.nodes.map(n => ({
    id: n.id,
    label: n.label,
    shape: 'dot',
    size: 18,
    color: {
      background: nodeColorForType(n.type),
      border: '#020617',
      highlight: { background: nodeColorForType(n.type), border: '#f9fafb' }
    },
    font: { color: '#e5e7eb', size: 14 },
    type: n.type
  }));

  const edges = scenario.edges.map((e, idx) => ({
    id: 'e' + idx,
    from: e.from,
    to: e.to,
    arrows: 'to',
    color: { color: '#4b5563', highlight: '#6366f1' },
    width: 1.2,
    label: edgeLabel(e.type),
    font: { color: '#9ca3af', size: 10 },
    type: e.type
  }));

  const nodeById = {};
  nodes.forEach(n => { nodeById[n.id] = n; });

  return { nodes, edges, nodeById, edgesRaw: scenario.edges };
}

function renderNetwork() {
  const container = document.getElementById('network');
  const data = {
    nodes: new vis.DataSet(graphData.nodes),
    edges: new vis.DataSet(graphData.edges)
  };
  const options = {
    physics: {
      stabilization: true,
      barnesHut: { gravitationalConstant: -5000, springLength: 120 }
    },
    interaction: { hover: true }
  };
  network = new Network(container, data, options);

  network.on('click', params => {
    if (params.nodes.length > 0) {
      const nodeId = params.nodes[0];
      const node = graphData.nodeById[nodeId];
      if (node) {
        showNodeExplanation(node);
        switchTab('tabNode');
      }
    }
  });
}

function explainNode(node) {
  const neighbors = graphData.edgesRaw
    .filter(e => e.from === node.id || e.to === node.id)
    .map(e => e.from === node.id ? e.to : e.from);
  const neighborTypes = neighbors.map(id => graphData.nodeById[id]?.type || 'other');

  const sellers = neighborTypes.filter(t => t === 'seller').length;
  const buyers = neighborTypes.filter(t => t === 'buyer').length;
  const banks = neighborTypes.filter(t => t === 'bank').length;
  const devices = neighborTypes.filter(t => t === 'device').length;
  const cards = neighborTypes.filter(t => t === 'card').length;
  const disputes = neighborTypes.filter(t => t === 'dispute').length;

  if (node.type === 'bank') {
    return `
${node.label} is a payout / bank node that receives flows from ${sellers} seller/merchant node(s) and is indirectly linked to ${buyers} buyer node(s).
Such a central payout node can represent a mule or coordinator account if value flows exceed what would be expected for a single legitimate business or individual.
An investigator should confirm the true owner, review KYC documents, compare inflows/outflows vs declared income, and check for rapid onward transfers or links to known scam/fraud patterns.
`;
  }

  if (node.type === 'device') {
    return `
${node.label} is a device shared across ${buyers} buyer account(s) and ${sellers} seller/merchant node(s).
Shared devices across multiple identities are strong linkage signals in abuse scenarios, especially when combined with abnormal order, refund, or dispute patterns.
Investigators should correlate this device with IPs, locations, and prior risk events, and assess whether it appears in other suspicious clusters across the platform or PSP.
`;
  }

  if (node.type === 'seller') {
    return `
${node.label} is a seller/merchant node connected to ${buyers} buyer node(s), ${banks} payout node(s), ${devices} device node(s), and ${cards} card node(s).
Its position in the graph and connection mix can indicate whether it is a potential anchor for a collusive ring, a victim of hostile activity, or a normal business.
Investigators should examine its order/refund ratios, review/complaint patterns, pricing history, and any prior enforcement or risk flags in combination with this network context.
`;
  }

  if (node.type === 'buyer') {
    return `
${node.label} is a buyer node linked to ${sellers} seller/merchant node(s), ${cards} card node(s), and ${devices} device node(s).
Multiple links across sellers and shared devices or payment methods increase the likelihood that this buyer is part of a coordinated abuse pattern rather than a purely legitimate customer.
Investigators should review its dispute/chargeback history, geolocation/IP patterns, and linkage to other known bad actors.
`;
  }

  if (node.type === 'card') {
    return `
${node.label} is a payment instrument node linked to ${buyers} buyer node(s) and ${sellers} seller/merchant node(s).
Cards used across multiple buyers or merchants with abnormal dispute or refund rates can signal synthetic identity, testing, or friendly fraud patterns.
Investigators should verify the issuing BIN, geolocation alignment, historical usage, and whether this instrument appears in other fraud or AML cases.
`;
  }

  return `
${node.label} is a node of type "${node.type}", connected to ${neighbors.length} other node(s).
At this time, there is no specialized template for this node type, but investigators should still review its connections, volumes, and any prior risk signals in combination with the broader graph.
`;
}

function buildScenarioSummary(scenario) {
  const sellers = scenario.nodes.filter(n => n.type === 'seller').length;
  const buyers = scenario.nodes.filter(n => n.type === 'buyer').length;
  const banks = scenario.nodes.filter(n => n.type === 'bank').length;
  const devices = scenario.nodes.filter(n => n.type === 'device').length;

  return `
Scenario "${scenario.name}" models a synthetic cluster with ${sellers} seller/merchant node(s), ${buyers} buyer node(s), ${banks} payout/bank node(s), and ${devices} shared device node(s).
The edges capture relationships such as orders, payouts, shared devices, and control links, representing patterns you have seen in real marketplace and PSP abuse cases.
This view is intended as a thinking and training aid: it does not represent real customers, but it mirrors how hostile rings, mule clusters, or competitor attacks can appear in network form.
`;
}

function buildLensNarrative(scenario, lens) {
  if (lens === 'fraud') {
    return `
From a fraud and chargeback perspective, this scenario highlights where financial loss can crystallize: 
orders that are cancelled, refunded, or disputed, and payout nodes that aggregate value before it leaves the platform or PSP.
Fraud teams should focus on loss exposure, arbitration win rates, promotion abuse, and controls around eligibility for refunds/cashback, as well as velocity and abnormal ratios vs peer baselines.
`;
  }
  if (lens === 'aml') {
    return `
From an AML / fincrime perspective, this network can resemble mule or pass-through structures where value is moved between accounts via fake commerce or coordinated buyer-seller behaviour.
The key questions are whether the flows align with declared business activity, whether payout nodes behave like personal vs business accounts, and whether there are links to known scams or higher-risk jurisdictions.
Such patterns can drive scenario refinement and may justify STR/SAR filings when combined with additional evidence.
`;
  }
  if (lens === 'ts') {
    return `
From a trust & safety perspective, this scenario demonstrates abuse of platform rules: fake demand, review manipulation, hostile seller activity, and coordination to harm competitors or game incentives.
Trust & safety teams should align with fraud and AML functions on a shared view of bad-actor networks, to ensure interventions target the right cluster of accounts rather than isolated symptoms.
This lens emphasizes user harm, marketplace integrity, and enforcement policy rather than purely financial or regulatory outcomes.
`;
  }
  return '';
}

function showNodeExplanation(node) {
  const headerEl = document.getElementById('nodeHeader');
  const explEl = document.getElementById('nodeExplanation');
  headerEl.innerHTML = `${nodeTypePill(node.type)} <strong>${node.label}</strong>`;
  const text = explainNode(node);
  lastNodeExplanation = text;
  explEl.textContent = text.trim();
}

function renderScenarioDetails() {
  if (!currentScenario) return;
  const summary = document.getElementById('summaryText');
  const lensEl = document.getElementById('lensNarrative');
  const checklistEl = document.getElementById('checklist');

  summary.textContent = buildScenarioSummary(currentScenario).trim();
  lensEl.textContent = buildLensNarrative(currentScenario, currentLens).trim();

  checklistEl.innerHTML = '';
  (currentScenario.checklist || []).forEach(item => {
    const li = document.createElement('li');
    li.textContent = item;
    checklistEl.appendChild(li);
  });
}

function switchTab(tabId) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll(`.tab-btn[data-tab="${tabId}"]`).forEach(btn => btn.classList.add('active'));
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadScenarios();

  const scenarioSelect = document.getElementById('scenarioSelect');
  const scenarioDesc = document.getElementById('scenarioDescription');
  const lensSelect = document.getElementById('lensSelect');
  const loadBtn = document.getElementById('loadScenarioBtn');

  const copySummaryBtn = document.getElementById('copySummaryBtn');
  const copyNodeBtn = document.getElementById('copyNodeBtn');
  const copyLensBtn = document.getElementById('copyLensBtn');
  const copyChecklistBtn = document.getElementById('copyChecklistBtn');

  // init description
  const firstScenario = getScenarioById(scenarioSelect.value);
  if (firstScenario) {
    currentScenario = firstScenario;
    scenarioDesc.textContent = firstScenario.description;
  }

  scenarioSelect.addEventListener('change', () => {
    const sc = getScenarioById(scenarioSelect.value);
    scenarioDesc.textContent = sc ? sc.description : '';
  });

  lensSelect.addEventListener('change', () => {
    currentLens = lensSelect.value;
    renderScenarioDetails();
    switchTab('tabScenarioLens');
  });

  loadBtn.addEventListener('click', () => {
    const sc = getScenarioById(scenarioSelect.value);
    if (!sc) return;
    currentScenario = sc;
    graphData = buildGraphFromScenario(sc);
    renderNetwork();
    renderScenarioDetails();
    switchTab('tabSummary');
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      switchTab(tabId);
    });
  });

  copySummaryBtn.addEventListener('click', () => {
    const text = document.getElementById('summaryText').textContent;
    navigator.clipboard.writeText(text.trim()).then(() => {
      copySummaryBtn.textContent = 'Copied!';
      setTimeout(() => copySummaryBtn.textContent = 'Copy summary', 1200);
    });
  });

  copyNodeBtn.addEventListener('click', () => {
    const text = lastNodeExplanation || document.getElementById('nodeExplanation').textContent;
    navigator.clipboard.writeText(text.trim()).then(() => {
      copyNodeBtn.textContent = 'Copied!';
      setTimeout(() => copyNodeBtn.textContent = 'Copy node insight', 1200);
    });
  });

  copyLensBtn.addEventListener('click', () => {
    const text = document.getElementById('lensNarrative').textContent;
    navigator.clipboard.writeText(text.trim()).then(() => {
      copyLensBtn.textContent = 'Copied!';
      setTimeout(() => copyLensBtn.textContent = 'Copy lens narrative', 1200);
    });
  });

  copyChecklistBtn.addEventListener('click', () => {
    const items = Array.from(document.querySelectorAll('#checklist li')).map(li => '- ' + li.textContent);
    const text = items.join('\n');
    navigator.clipboard.writeText(text.trim()).then(() => {
      copyChecklistBtn.textContent = 'Copied!';
      setTimeout(() => copyChecklistBtn.textContent = 'Copy checklist', 1200);
    });
  });

  // auto load first scenario
  if (firstScenario) {
    graphData = buildGraphFromScenario(firstScenario);
    renderNetwork();
    renderScenarioDetails();
  }
});
