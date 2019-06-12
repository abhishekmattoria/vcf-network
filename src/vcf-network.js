import { html, PolymerElement } from '@polymer/polymer/polymer-element';
import { ThemableMixin } from '@vaadin/vaadin-themable-mixin';
import { ElementMixin } from '@vaadin/vaadin-element-mixin';
import './lib/vis-network.web.js';
import './components/vcf-network-tool-panel';
import './components/vcf-network-breadcrumbs';
import './components/vcf-network-info-panel';

class VcfNetwork extends ElementMixin(ThemableMixin(PolymerElement)) {
  static get template() {
    return html`
      <style>
        :host {
          display: flex;
          position: relative;
        }

        :host([hidden]) {
          display: none !important;
        }

        .canvas-container {
          background: #fafafa;
          width: 100%;
          height: 75vh;
          z-index: 1;
        }
      </style>
      <vcf-hn-tool-panel id="toolpanel"></vcf-hn-tool-panel>
      <vcf-hn-breadcrumbs id="breadcrumbs"></vcf-hn-breadcrumbs>
      <div id="main" class="canvas-container"></div>
      <vcf-hn-info-panel id="infopanel"></vcf-hn-info-panel>
    `;
  }

  static get is() {
    return 'vcf-network';
  }

  static get version() {
    return '0.1.0';
  }

  static get properties() {
    return {
      data: {
        type: Object,
        value: () => ({
          nodes: new vis.DataSet(),
          edges: new vis.DataSet(),
          components: []
        })
      },
      import: {
        type: String,
        observer: '_importChanged'
      },
      addingEdge: {
        type: Boolean,
        observer: '_addingEdgeChanged'
      },
      addingNode: {
        type: Boolean,
        observer: '_addingNodeChanged'
      },
      addingComponent: {
        type: Object,
        observer: '_addingComponentChanged'
      },
      _options: {
        type: Object
      },
      _network: {
        type: Object
      },
      _addNodeCount: {
        type: Number,
        value: 0
      }
    };
  }

  connectedCallback() {
    super.connectedCallback();
    this._initNetwork();
    this._initComponents();
    this._initEventListeners();
    this._initMultiSelect();
    this._setMargins();
  }

  _setMargins() {
    this.$.main.style.marginTop = `${this.$.breadcrumbs.clientHeight}px`;
    this.$.main.style.marginRight = `${this.$.infopanel.clientWidth}px`;
    this.$.main.style.marginLeft = `${this.$.toolpanel.clientWidth}px`;
  }

  _initNetwork() {
    this._options = {
      physics: true,
      layout: {
        randomSeed: 42
      },
      nodes: {
        fixed: false,
        shape: 'box',
        borderWidth: 2,
        color: {
          background: '#ffffff',
          border: '#dadfe5',
          highlight: {
            background: '#ffffff',
            border: '#1576f3'
          }
        },
        font: {
          size: 10,
          color: 'rgba(27, 43, 65, 0.72)'
        },
        margin: {
          top: 6,
          right: 15,
          bottom: 6,
          left: 15
        }
      },
      edges: {
        arrows: 'to',
        length: 200,
        color: {
          color: '#dadfe5',
          highlight: '#90bbf9'
        }
      },
      manipulation: {
        enabled: false,
        addNode: this._addingNodeCallback.bind(this),
        addEdge: this._addingEdgeCallback.bind(this),
        controlNodeStyle: {
          shape: 'dot',
          size: 2,
          color: {
            background: '#1576f3'
          },
          borderWidth: 0,
          borderWidthSelected: 0
        }
      },
      interaction: {
        multiselect: true,
        selectConnectedEdges: false,
        dragNodes: true
      }
    };
    this._network = new vis.Network(this.$.main, this.data, this._options);
    this._manipulation = this._network.manipulation;
    this._canvas = this.shadowRoot.querySelector('canvas');
    this._ctx = this._canvas.getContext('2d');
  }

  _initComponents() {
    this.$.infopanel._parent = this;
    this.$.toolpanel._parent = this;
    this.$.breadcrumbs._parent = this;
  }

  _initEventListeners() {
    this._network.on('dragStart', opt => {
      if (opt.nodes.length === 1) {
        const nodeId = opt.nodes[0];
        this.addingEdge = true;
        this._manipulation._handleConnect(opt.event);
        this._manipulation._temporaryBindUI('onRelease', e => {
          const node = this._detectNode(e);
          if (node && node.id !== nodeId) {
            this._manipulation._finishConnect(e);
          } else {
            this._reset();
          }
        });
      }
    });
    this._network.on('release', () => {
      this._network.moveTo({ scale: 2 });
    });
    this._network.on('select', opt => {
      this.$.infopanel.selection = opt;
    });
    this._network.on('click', opt => {
      if (this.addingComponent && !opt.nodes.length) {
        const idMap = {};
        const component = this.addingComponent;
        const nodes = component.nodes.map(node => {
          idMap[node.id] = vis.util.randomUUID();
          const coords = this._network.DOMtoCanvas(opt.event.center);
          return {
            ...node,
            id: idMap[node.id],
            x: node.x + coords.x,
            y: node.y + coords.y
          };
        });
        const edges = component.edges.map(edge => {
          idMap[edge.id] = vis.util.randomUUID();
          return {
            ...edge,
            from: idMap[edge.from],
            to: idMap[edge.to],
            id: idMap[edge.id]
          };
        });
        this.data.nodes.add(nodes);
        this.data.edges.add(edges);
        this.addingComponent = null;
      }
    });
  }

  _initMultiSelect() {
    this._selectionRect = {};
    const saveDrawingSurface = () => {
      this._drawingSurfaceImageData = this._ctx.getImageData(
        0,
        0,
        this._canvas.width,
        this._canvas.height
      );
    };
    const restoreDrawingSurface = () => {
      this._ctx.putImageData(this._drawingSurfaceImageData, 0, 0);
    };
    const getStartToEnd = (start, length) => {
      return length > 0
        ? { start: start, end: start + length }
        : { start: start + length, end: start };
    };
    const selectNodesFromHighlight = () => {
      const nodesIdInDrawing = [];
      const xRange = getStartToEnd(this._selectionRect.startX, this._selectionRect.w);
      const yRange = getStartToEnd(this._selectionRect.startY, this._selectionRect.h);
      const allNodes = this._network.body.nodes;
      for (let i = 0; i < allNodes.length; i++) {
        const curNode = allNodes[i];
        const nodePosition = this._network.getPositions([curNode.id]);
        const nodeXY = this._network.canvasToDOM({
          x: nodePosition[curNode.id].x,
          y: nodePosition[curNode.id].y
        });
        if (
          xRange.start <= nodeXY.x &&
          nodeXY.x <= xRange.end &&
          yRange.start <= nodeXY.y &&
          nodeXY.y <= yRange.end
        ) {
          nodesIdInDrawing.push(curNode.id);
        }
      }
      this._network.selectNodes(nodesIdInDrawing);
    };
    this.$.main.addEventListener('mousemove', e => {
      if (this._selectionDrag) {
        restoreDrawingSurface();
        this._selectionRect.w = e.pageX - this.offsetLeft - this._selectionRect.startX;
        this._selectionRect.h = e.pageY - this.offsetTop - this._selectionRect.startY;
        this._ctx.setLineDash([5]);
        this._ctx.strokeStyle = 'rgb(0, 102, 0)';
        this._ctx.strokeRect(
          this._selectionRect.startX,
          this._selectionRect.startY,
          this._selectionRect.w,
          this._selectionRect.h
        );
        this._ctx.setLineDash([]);
        this._ctx.fillStyle = 'rgba(0, 255, 0, 0.2)';
        this._ctx.fillRect(
          this._selectionRect.startX,
          this._selectionRect.startY,
          this._selectionRect.w,
          this._selectionRect.h
        );
      }
    });
    this.$.main.addEventListener('mousedown', e => {
      if (e.button == 2) {
        saveDrawingSurface();
        this._selectionRect.startX = e.pageX - this.offsetLeft;
        this._selectionRect.startY = e.pageY - this.offsetTop;
        this._selectionDrag = true;
        this.$.main.style.cursor = 'crosshair';
      }
    });
    this.$.main.addEventListener('mouseup', e => {
      if (e.button == 2) {
        restoreDrawingSurface();
        this._selectionDrag = false;
        this.$.main.style.cursor = 'default';
        selectNodesFromHighlight();
      }
    });
    this.$.main.oncontextmenu = () => false;
  }

  _addingNodeChanged() {
    if (this.addingNode) {
      this._network.addNodeMode();
      this.addingEdge = false;
      this.addingComponent = null;
      this._canvas.style.cursor = 'crosshair';
    } else {
      this._canvas.style.cursor = 'default';
    }
  }

  _addingEdgeChanged() {
    if (this.addingEdge) {
      this._network.addEdgeMode();
      this.addingNode = false;
      this.addingComponent = null;
      this._canvas.style.cursor = 'crosshair';
    } else {
      this._canvas.style.cursor = 'default';
    }
  }

  _addingComponentChanged() {
    if (this.addingComponent) {
      this.addingEdge = false;
      this.addingNode = false;
      this._canvas.style.cursor = 'crosshair';
    } else {
      this._canvas.style.cursor = 'default';
    }
  }

  _dataChanged() {}

  _addingNodeCallback(data, callback) {
    this.data.nodes.add({
      id: data.id,
      label: `Node ${++this._addNodeCount}`,
      x: data.x,
      y: data.y
    });
    this.addingNode = false;
    this.$.toolpanel.clear();
    this._canvas.style.cursor = 'default';
  }

  _addingEdgeCallback(data, callback) {
    this.data.edges.add({
      from: data.from,
      to: data.to
    });
    this.addingEdge = false;
    this._canvas.style.cursor = 'default';
  }

  _detectNode(event) {
    const pointer = this._manipulation.body.functions.getPointer(event.center);
    const pointerObj = this._manipulation.selectionHandler._pointerToPositionObject(pointer);
    const nodeIds = this._manipulation.selectionHandler._getAllNodesOverlappingWith(pointerObj);
    let node = undefined;
    for (const id of nodeIds) {
      if (this._manipulation.temporaryIds.nodes.indexOf(id) === -1) {
        node = this._manipulation.body.nodes[id];
        break;
      }
    }
    return node;
  }

  _reset() {
    this.addingNode = false;
    this.addingEdge = false;
    this.$.toolpanel.clear();
    this._manipulation._clean();
    this._manipulation._restore();
  }

  _importChanged(src) {
    fetch(src)
      .then(res => res.json())
      .then(json => {
        this.$.toolpanel.set('components', [json]);
      });
  }
}

customElements.define(VcfNetwork.is, VcfNetwork);