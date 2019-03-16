class LineChart {
  constructor({ root, data, offset }) {
    this.data = normalizeData(data);
    this.root = root;
    this.offset = { left: 20, right: 20, ...offset };
    this.nodes = {
      container: {
        backNode: document.createElement("div"),
        node: document.createElement("div"),
      },
      canvas: {
        node: document.createElement("canvas"),
        backNode: document.createElement("canvas"),
        height: 400,
      },
      previewCanvas: {
        backNode: document.createElement("canvas"),
        node: document.createElement("canvas"),
        height: 54,
      },
    };

    const devicePixelRatio = window.devicePixelRatio || 1;

    this.controlBorderWidth = 5 * devicePixelRatio;
    this.startPanelGrabbing = null;
    this.panelX = 0;
    this.panelW = 0;
    this.maxValue = 0;
    this.lineLengthPreviewCanvas = 0;
    this.lineLength = (window.innerWidth / (getDataMaxLength(this.data) / 4)) * devicePixelRatio;
    this.classNamePrefix = "tgLineChart";
    this.disabledLines = [];
    this.init();
  }

  init() {
    this.appendNodes();
    this.resizeNodes();
    this.redraw();
    this.setListeners();
  }

  redraw() {
    const { nodes, lineLength, offset, disabledLines } = this;
    const {
      canvas: { node: canvas, backNode: canvasBackNode },
      previewCanvas: { node: previewCanvas, backNode },
    } = nodes;
    const { left } = offset;
    const devicePixelRatio = window.devicePixelRatio;

    const data = this.data.filter(({ name }) => !disabledLines.some(s => s === name));

    const { width: canvasW, height: canvasH } = this.getWithHeigthByRatio(canvas);
    const { width: previewCanvasW, height: previewCanvasH } = this.getWithHeigthByRatio(
      previewCanvas,
    );

    this.panelW = this.getPanelWidthFromLineLength();
    this.panelX = previewCanvasW - this.panelW;

    this.lineLengthPreviewCanvas = getLineLength(data, previewCanvasW);
    const from = getDataMaxLength(data) - 1 - canvasW / lineLength;
    const to = getDataMaxLength(data);
    this.maxValue = getMaxValueFromTo({ data, from: Math.floor(from), to });
    const canvasBackNodeWidth = to * lineLength * devicePixelRatio;
    canvasBackNode.setAttribute("width", canvasBackNodeWidth);
    const ctx = canvas.getContext("2d");

    data.forEach(item => {
      if (item.type === "line") {
        // preview canvas
        this.drawLine({
          width: canvasW,
          height: previewCanvasH,
          data: item,
          maxValue: getMaxValue(data),
          canvas: previewCanvas,
          lineLength: this.lineLengthPreviewCanvas,
          lineWidth: 1.5,
        });

        // fake canvas
        this.drawLine({
          data: item,
          maxValue: getMaxValueFromTo({ data, from, to }),
          canvas: canvasBackNode,
          lineLength,
          lineWidth: 3.5,
          width: canvasBackNodeWidth,
          height: canvasH,
        });
      }
    });

    const x = from * lineLength;
    ctx.drawImage(canvasBackNode, -x, 0);
    this.clearCanvas(backNode, previewCanvasW + left * devicePixelRatio, previewCanvasH);
    const backCtx = backNode.getContext("2d");
    backCtx.drawImage(previewCanvas, 0, 0);
    this.fillPreviewCanvas(previewCanvasW - this.panelW, this.panelW);
  }

  getGrab(x) {
    const { nodes, lineLength, panelW, disabledLines } = this;
    const data = this.data.filter(({ name }) => !disabledLines.some(s => s === name));
    const {
      previewCanvas: { node: previewCanvas },
    } = nodes;
    const { width: previewCanvasW } = this.getWithHeigthByRatio(previewCanvas);

    const devicePixelRatio = window.devicePixelRatio;
    const lines = getDataMaxLength(data) - 1;
    const canvasWidth = lines * lineLength * devicePixelRatio;
    const ratio = canvasWidth / previewCanvasW;
    const from = Math.floor((x * ratio) / (lineLength * devicePixelRatio)) + 1;
    const to = Math.ceil((x * ratio + panelW * ratio) / (lineLength * devicePixelRatio));
    const maxValue = getMaxValueFromTo({ data, from, to });

    return { maxValue, from, to, ratio, canvasWidth };
  }

  handleMove(e) {
    const {
      data,
      nodes,
      startPanelGrabbing,
      panelW,
      maxValue,
      offset,
      disabledLines,
      lineLength,
    } = this;
    const { left, right } = offset;
    const { previewCanvas } = nodes;
    const {
      canvas: { node: canvas, backNode: canvasBackNode },
    } = nodes;
    const { move, leftBorder, rightBorder } = this.insidePanel(e);

    if (startPanelGrabbing === null) {
      if (move) {
        previewCanvas.node.style.cursor = "grab";
      } else if (leftBorder || rightBorder) {
        previewCanvas.node.style.cursor = "col-resize";
      } else {
        previewCanvas.node.style.cursor = "default";
      }
    } else if (isNumeric(startPanelGrabbing)) {
      const { height: canvasH } = this.getWithHeigthByRatio(canvas);
      const { width } = this.getWithHeigthByRatio(previewCanvas.node);
      const devicePixelRatio = window.devicePixelRatio;
      const { x } = getPosition(e, devicePixelRatio);
      const positionX = x - startPanelGrabbing;
      const nextX = rateLimit(this.panelX + positionX, 0, width - panelW);

      this.clearCanvas(previewCanvas.node);
      const ctxPreview = previewCanvas.node.getContext("2d");
      ctxPreview.drawImage(previewCanvas.backNode, 0, 0);
      this.fillPreviewCanvas(nextX, this.panelW);

      const { maxValue: nextMaxValue, ratio, canvasWidth } = this.getGrab(nextX);

      if (maxValue !== nextMaxValue) {
        this.maxValue = nextMaxValue;
        this.clearCanvas(canvasBackNode, canvasWidth + (left + right) * devicePixelRatio, canvasH);

        const filteredData = data.filter(({ name }) => !disabledLines.some(s => s === name));

        filteredData.forEach(item => {
          if (item.type === "line") {
            this.drawLine({
              data: item,
              maxValue: nextMaxValue,
              canvas: canvasBackNode,
              lineLength,
              lineWidth: 3.5,
              width: canvasWidth,
              height: canvasH,
            });
          }
        });
      }

      const ctx = canvas.getContext("2d");
      this.clearCanvas(canvas);
      ctx.drawImage(canvasBackNode, (-nextX * ratio) / devicePixelRatio, 0);
    }
  }

  getWithHeigthByRatio(node, fullWidth) {
    const { left = 0, right = 0 } = fullWidth || this.offset;

    const devicePixelRatio = window.devicePixelRatio;
    const { width: w, height: h } = node.getBoundingClientRect();

    return {
      width: w * devicePixelRatio - left * devicePixelRatio - right * devicePixelRatio,
      height: h * devicePixelRatio,
    };
  }

  drawLine({ data, maxValue, canvas, width, height, lineLength, lineWidth }) {
    const { offset } = this;
    const { values, color } = data;

    const { left } = offset;
    const devicePixelRatio = window.devicePixelRatio;

    const ctx = canvas.getContext("2d");

    let prevX = 0;
    let prevY = 0;

    for (let i = 0; i < values.length; i++) {
      ctx.lineCap = "round";
      const x =
        i !== 0
          ? lineLength * i + left * devicePixelRatio - (lineWidth / 2) * devicePixelRatio
          : left * devicePixelRatio + (lineWidth / 2) * devicePixelRatio;
      const y = height - (((values[i] * 100) / maxValue) * height) / 100;
      ctx.beginPath();
      if (i > 0) {
        ctx.moveTo(prevX, prevY);
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineTo(x, y);

      ctx.stroke();

      prevX = x;
      prevY = y;
    }
  }

  initControl({ name, color, chart }) {
    const { nodes } = this;
    const { container } = nodes;
    const label = document.createElement("label");
    const text = document.createElement("span");
    text.innerText = `graph ${chart}`;
    const icon = document.createElement("div");
    icon.classList.add(`${this.classNamePrefix}-checkmark-icon`);
    icon.style.borderColor = color;
    label.classList.add(`${this.classNamePrefix}-control`);
    const input = document.createElement("input");
    input.addEventListener("change", this.onChange.bind(this, name));
    label.appendChild(input);
    label.appendChild(icon);
    label.appendChild(text);
    input.setAttribute("type", "checkbox");
    input.setAttribute("checked", "checked");
    container.node.appendChild(label);
  }

  onChange(name) {
    const { disabledLines, nodes, panelX } = this;
    const { canvas, previewCanvas } = nodes;
    const isDisabled = disabledLines.some(item => item === name);

    this.clearCanvas(canvas.node);
    this.clearCanvas(previewCanvas.node);
    if (isDisabled) {
      this.disabledLines = disabledLines.filter(item => item !== name);
    } else {
      this.disabledLines.push(name);
    }
    this.drawByXPosition(panelX);
  }

  appendNodes() {
    const { data, nodes } = this;

    Object.keys(nodes).forEach((key, i, array) => {
      const { node } = nodes[key];
      node.classList.add(`${this.classNamePrefix}-${key}`);

      if (key !== "container") {
        const { node: container } = nodes[array[0]];
        container.appendChild(node);
      } else {
        this.root.appendChild(node);
      }
    });

    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      if (item.type === "line") {
        this.initControl(item);
      }
    }
  }

  handleResize() {
    this.resizeNodes();
    this.redraw();
  }

  resizeNodes() {
    const { nodes } = this;

    const devicePixelRatio = window.devicePixelRatio;
    const largePxRatio = devicePixelRatio > 1;

    Object.keys(nodes).forEach((key, i, array) => {
      const { node, height, backNode } = nodes[key];

      if (key !== "container") {
        const { node: container } = nodes[array[0]];
        const { width } = container.getBoundingClientRect();

        if (largePxRatio) {
          node.setAttribute("width", width * devicePixelRatio);
          node.setAttribute("height", height * devicePixelRatio);
          node.style.width = width + "px";
          node.style.height = height + "px";
        } else {
          node.setAttribute("width", width);
          node.setAttribute("height", height);
        }

        if (backNode) {
          if (largePxRatio) {
            backNode.setAttribute("width", width * devicePixelRatio);
            backNode.setAttribute("height", height * devicePixelRatio);
            backNode.style.width = width + "px";
            backNode.style.height = height + "px";
          } else {
            backNode.setAttribute("width", width);
            backNode.setAttribute("height", height);
          }
        }
      }
    });
  }

  setListeners() {
    document.addEventListener("mousemove", this.handleMove.bind(this));
    document.addEventListener("touchmove", this.handleMove.bind(this));
    document.addEventListener("mousedown", this.handleDown.bind(this));
    document.addEventListener("touchstart", this.handleDown.bind(this));
    document.addEventListener("mouseup", this.handleUp.bind(this));
    document.addEventListener("touchend", this.handleUp.bind(this));
    window.addEventListener("resize", this.handleResize.bind(this));
  }

  clearCanvas(canvas, w, h) {
    const { width, height } = this.getWithHeigthByRatio(canvas, true);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w || width, h || height);
  }

  getPanelWidthFromLineLength() {
    const { nodes, data, lineLength } = this;
    const { canvas, previewCanvas } = nodes;

    const { width: canvasWidth } = this.getWithHeigthByRatio(canvas.node);

    const { width: previewCanvasWidth } = this.getWithHeigthByRatio(previewCanvas.node);

    const lineLengthPreviewCanvas = getLineLength(data, previewCanvasWidth);

    const panelWidth = (canvasWidth / lineLength) * lineLengthPreviewCanvas;

    return panelWidth;
  }

  getPanelRect() {
    const { panelW, controlBorderWidth, nodes, offset, panelX } = this;
    const { previewCanvas } = nodes;
    const { left, right } = offset;

    const { height } = this.getWithHeigthByRatio(previewCanvas.node);

    return [
      panelX + controlBorderWidth + left,
      0,
      panelX + panelW - controlBorderWidth + right,
      height,
    ];
  }

  handleUp(e) {
    const { nodes, startPanelGrabbing, panelX } = this;
    const { previewCanvas } = nodes;
    const devicePixelRatio = window.devicePixelRatio;
    const { x } = getPosition(e, devicePixelRatio);
    const { width } = this.getWithHeigthByRatio(previewCanvas.node);

    if (isNumeric(startPanelGrabbing)) {
      const positionX = x - startPanelGrabbing;
      this.panelX = rateLimit(panelX + positionX, 0, width - this.panelW);

      this.startPanelGrabbing = null;
      document.documentElement.style.cursor = "";
    }

    const { move, leftBorder, rightBorder } = this.insidePanel(e);

    if (move) {
      previewCanvas.node.style.cursor = "grab";
    } else if (leftBorder || rightBorder) {
      previewCanvas.node.style.cursor = "col-resize";
    } else {
      previewCanvas.node.style.cursor = "default";
    }
  }

  handleDown(e) {
    const { previewCanvas } = this.nodes;
    const { x } = getPosition(e);
    const { move, leftBorder, rightBorder } = this.insidePanel(e);
    const devicePixelRatio = window.devicePixelRatio;

    if (move) {
      this.startPanelGrabbing = x * devicePixelRatio;
      document.documentElement.style.cursor = "grabbing";
      previewCanvas.node.style.cursor = "grabbing";
    } else if (leftBorder || rightBorder) {
      document.documentElement.style.cursor = "col-resize";
    }
  }

  insidePanel(e) {
    const { controlBorderWidth } = this;
    const devicePixelRatio = window.devicePixelRatio;
    const { x, y } = getPosition(e, devicePixelRatio);
    const panelReact = this.getPanelRect();
    const [xMin, yMin, xMax, yMax] = panelReact;

    const leftBorderRect = [xMin - controlBorderWidth, yMin, xMin + controlBorderWidth, yMax];
    const rightBorderRect = [xMax, yMin, xMax + controlBorderWidth, yMax];

    return {
      leftBorder: isDotInsideRect([x, y], leftBorderRect),
      rightBorder: isDotInsideRect([x, y], rightBorderRect),
      move: isDotInsideRect([x, y], panelReact),
    };
  }

  fillPreviewCanvas(x, panelWidth) {
    const { nodes, controlBorderWidth, offset } = this;
    const {
      previewCanvas: { node: previewCanvas },
    } = nodes;
    const { left } = offset;
    const devicePixelRatio = window.devicePixelRatio;

    const { width, height } = this.getWithHeigthByRatio(previewCanvas);

    const ctx = previewCanvas.getContext("2d");

    ctx.beginPath();
    ctx.fillStyle = hexToRGB("#F4F9FC", 0.76);

    // before
    ctx.rect(left * devicePixelRatio, 0, x, height);
    ctx.fill();

    ctx.beginPath();
    // after
    ctx.rect(x + panelWidth + left * devicePixelRatio, 0, width - x - panelWidth, height);
    ctx.fill();

    // center
    ctx.beginPath();
    ctx.lineWidth = controlBorderWidth;
    ctx.strokeStyle = "rgba(0,0,0, 0.14)";
    ctx.rect(
      x + left * devicePixelRatio + controlBorderWidth / 2,
      0,
      panelWidth - controlBorderWidth,
      height,
    );
    ctx.stroke();
  }

  destroy() {
    const {
      container: { node },
    } = this.nodes;
    node.remove();
  }
}
