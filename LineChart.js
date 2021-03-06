"use asm";
"use strict";

class LineChart {
  constructor({ root, data, header, dark = false, left = 20, right = 20, bottom = 44, top = 24 }) {
    const devicePixelRatio = window.devicePixelRatio || 1;
    this.classNamePrefix = "tgLineChart";
    this.font = "Tahoma,sans-serif,Arial,Helvetica";

    this.darkTheme = {
      fillColor: "#242F3E",
      tooltipFill: "#253241",
      tooltipShadowColor: "#1f2733",
      textColor: "#fff",
      gridLineColor: "#2F3C4C",
      labelColor: "#526d83",
      previewFill: "rgba(31,42,55,0.74)",
      previewStroke: "rgba(64,86,107,0.86)",
    };

    this.lightTheme = {
      fillColor: "#fff",
      tooltipFill: "#fff",
      tooltipShadowColor: "rgba(213,213,213,0.9)",
      textColor: "#262c37",
      gridLineColor: "#e9e9e9",
      labelColor: "#9CA1A6",
      previewFill: "rgba(244,249,252,0.84)",
      previewStroke: "rgba(0,0,0,0.14)",
    };

    this.theme = dark ? this.darkTheme : this.lightTheme;
    const container = document.createElement("div");
    container.classList.add(`${this.classNamePrefix}-${dark ? "dark" : "light"}`);

    this.savedData = data;
    this.data = data;
    this.root = root;
    this.header = header;
    this.offset = {
      left,
      right,
      top,
      bottom,
    };
    this.labelWidthLimit = 74 * devicePixelRatio;
    this.nodes = {
      container: {
        node: container,
      },
      canvas: {
        node: document.createElement("canvas"),
        backNode: document.createElement("canvas"),
        height: 400,
        lineWidth: 3 * devicePixelRatio,
      },
      previewCanvas: {
        backNode: document.createElement("canvas"),
        node: document.createElement("canvas"),
        height: 54,
        lineWidth: 1.5 * devicePixelRatio,
      },
    };

    this.controlBorderWidth = 5 * devicePixelRatio;
    this.startPanelGrabbing = null;
    this.startPanelResize = null;
    this.panelX = 0;
    this.panelW = 0;
    this.maxValue = 0;
    this.lineLengthPreviewCanvas = 0;
    this.ticks = 6;
    this.duration = 244;
    this.lineLength = rateLimit(window.innerWidth / (getDataMaxLength(this.data) - 1)) * devicePixelRatio * 4;
    this.labelDivider = getLabelDivider(this.labelWidthLimit, this.lineLength);
    this.disabledLines = [];
    this.devicePixelRatio = devicePixelRatio;
    this.animationY = false;
    this.selectedItem = null;
    this.init();
    this.drawTooltip = throttle(this.drawTooltip, this.duration + 4);
    this.animateYAxisThrottled = throttle(this.animateYAxis, this.duration + 4);
    this.animateXAxisThrottled = throttle(this.animateXAxis, this.duration + 4);
  }

  init() {
    this.appendNodes();
    this.resizeNodes();
    this.overdraw();
    this.setListeners();
    this.handleResize();
  }

  animate({ duration = 144, timing, draw }) {
    const self = this;
    const start = performance.now();
    requestAnimationFrame(function animate(time) {
      let timeFraction = (time - start) / duration;
      if (timeFraction > 1) timeFraction = 1;
      const progress = timing(timeFraction);
      draw(progress, self);
      if (timeFraction < 1) {
        requestAnimationFrame(animate);
      }
    });
  }

  updateTheme({ dark }) {
    const {
      classNamePrefix,
      nodes: {
        container: { node: container },
      },
    } = this;
    this.theme = dark ? this.darkTheme : this.lightTheme;

    if (dark) {
      container.classList.remove(`${classNamePrefix}-light`);
      container.classList.add(`${classNamePrefix}-dark`);
    } else {
      container.classList.remove(`${classNamePrefix}-dark`);
      container.classList.add(`${classNamePrefix}-light`);
    }
    this.clearAllCanvases();

    const { from, to, maxValue } = this.getGrab({ x: this.panelX, panelWidth: this.panelW });
    const axialShift = getAxialShift(this.lineLength, from);

    this.drawYAxis();
    this.drawXAxis({ from, to, axialShift, lineLength: this.lineLength, divider: this.labelDivider });
    this.redraw({
      data: this.data,
      panelX: this.panelX,
      panelW: this.panelW,
      from,
      to,
      maxValue,
      axialShift,
    });
  }

  overdraw() {
    const { nodes, lineLength, data, labelDivider } = this;
    const {
      previewCanvas: { node: previewCanvas, backCtx },
    } = nodes;

    const { width: previewCanvasW } = this.getWithHeigthByRatio(previewCanvas);
    this.panelW = this.getPanelWidth();
    this.lineLengthPreviewCanvas = getLineLength(data, previewCanvasW);

    this.panelX = previewCanvasW - this.panelW;
    const { from } = this.getGrab({ x: this.panelX, panelWidth: this.panelW });
    const to = getDataMaxLength(data);
    this.maxValue = getMaxValueFromTo({ data, from, to });
    const axialShift = getAxialShift(lineLength, from);

    backCtx.drawImage(previewCanvas, 0, 0);

    this.drawYAxis();
    this.drawXAxis({
      from,
      to,
      axialShift,
      divider: labelDivider,
      lineLength,
    });
    this.redraw({
      data,
      panelX: this.panelX,
      panelW: this.panelW,
      from,
      to,
      maxValue: this.maxValue,
      axialShift,
    });
  }

  redraw({
    data,
    panelX,
    panelW,
    from = 0,
    to = 1,
    withPreview = true,
    maxValue,
    previewMaxValue,
    axialShift = 0,
    alpha = 1,
    lineLength = this.lineLength,
    nextName,
    nextLabelDivider,
    alphaLabel = 1,
  }) {
    const { nodes, offset } = this;
    const { bottom, top } = offset;
    const {
      canvas: { node: canvas, ctx, lineWidth: canvasLineWidth },
      previewCanvas: { node: previewCanvas, ctx: previewCtx, backCtx, lineWidth: previewLineWidth },
    } = nodes;

    const { height: canvasH } = this.getWithHeigthByRatio(canvas);
    const { height: previewCanvasH } = this.getWithHeigthByRatio(previewCanvas);

    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      const { type, name } = item;

      if (type === "line") {
        // main canvas
        this.draw({
          ctx,
          alpha: name === nextName ? alpha : 1,
          axialShift,
          data: item,
          maxValue,
          canvas,
          lineLength,
          lineWidth: canvasLineWidth,
          height: canvasH,
          top,
          bottom,
          from,
          to,
          alphaLabel,
        });

        // preview canvas
        if (withPreview) {
          this.draw({
            ctx: previewCtx,
            alpha: name === nextName ? alpha : 1,
            top: 4,
            height: previewCanvasH,
            data: item,
            previewMaxValue: previewMaxValue || getMaxValueFromTo({ data, from: 0, to: getDataMaxLength(data) }),
            canvas: previewCanvas,
            lineLength: this.lineLengthPreviewCanvas - 1 / (getDataMaxLength(data) - 1),
            lineWidth: previewLineWidth,
          });
        }
      }
    }

    if (withPreview) {
      backCtx.drawImage(previewCanvas, 0, 0);
      this.fillPreviewCanvas(panelX, panelW);
    }
  }

  drawYAxis({ progress = 1, translateY = 0, max = 0 } = {}) {
    const { nodes, offset, devicePixelRatio, theme, font, ticks } = this;
    const { gridLineColor, labelColor } = theme;
    const {
      canvas: { node: canvas, ctx },
    } = nodes;
    const maxValue = max || this.maxValue;

    const left = offset.left * devicePixelRatio;
    const yScale = Array.from({ length: ticks }, (_, index) => Math.ceil(maxValue / ticks) * index);
    const { width, height } = this.getWithHeigthByRatio(canvas);
    const h = height - (offset.bottom + offset.top) * devicePixelRatio;

    ctx.textAlign = "left";
    const textPx = 14 * devicePixelRatio;
    ctx.font = `${textPx}px ${font}`;

    for (let i = 0; i < yScale.length; i++) {
      const y = i !== 0 ? h - i * (h / ticks) - 0.5 - translateY + +offset.top * devicePixelRatio : h - 0.5 + offset.top * devicePixelRatio;
      const rY = (0.5 + y) | 0;

      ctx.beginPath();
      ctx.fillStyle = hexToRGB(labelColor, progress);
      ctx.fillText(numberWithSpaces(yScale[i]), left, rY - 8);
      ctx.strokeStyle = hexToRGB(gridLineColor, progress);
      ctx.lineWidth = 1 * devicePixelRatio;
      ctx.moveTo(left, rY);
      ctx.lineTo(width + left, rY);
      ctx.stroke();
    }
  }

  getGrab({ x, panelWidth, withoutMaxValue = false, nextData } = {}) {
    const { nodes, lineLength, offset, devicePixelRatio, maxValue: prevMaxValue } = this;
    const data = nextData || this.data;

    const {
      previewCanvas: { node: previewCanvas },
    } = nodes;
    const { width: previewCanvasW } = this.getWithHeigthByRatio(previewCanvas);
    const lines = getDataMaxLength(data) - 1;

    const canvasWidth = lines * lineLength * devicePixelRatio;
    const ratio = canvasWidth / previewCanvasW;

    const from = rateLimit((x * ratio) / (lineLength * devicePixelRatio), 0);
    const to = rateLimit((x * ratio + panelWidth * ratio) / (lineLength * devicePixelRatio), 0, lines + 1);

    let maxValue = prevMaxValue;

    if (!withoutMaxValue) {
      maxValue = getMaxValueFromTo({ data, from, to });
    }

    const limit = to === 0 ? [1, 2] : [lines - 1, 0];

    return {
      lines,
      maxValue,
      from: rateLimit(from, 0, limit[0]),
      to: rateLimit(to, limit[1], lines + 1),
      ratio,
      canvasWidth: canvasWidth + offset.left + offset.right,
    };
  }

  getWithHeigthByRatio(node) {
    const { devicePixelRatio } = this;
    const { left = 0, right = 0 } = this.offset;

    const { width: w, height: h } = node.getBoundingClientRect();

    return {
      width: w * devicePixelRatio - left * devicePixelRatio - right * devicePixelRatio,
      height: h * devicePixelRatio,
    };
  }

  draw({ data, maxValue, previewMaxValue, ctx, height, lineLength, lineWidth, from = 0, to, axialShift = 0, bottom = 0, top = 0, alpha } = {}) {
    const { offset, devicePixelRatio } = this;
    const { values, color } = data;
    const { left } = offset;
    ctx.save();

    let prevX = 0;
    let prevY = 0;

    ctx.lineCap = "round";
    ctx.strokeStyle = hexToRGB(color, alpha);
    ctx.lineWidth = lineWidth;
    ctx.translate(0.5, 0.5);

    let startIndex = 0;
    const h = height - (bottom + top) * devicePixelRatio;
    const fromInt = Math.floor(from);

    for (let i = fromInt; i < values.length; i++) {
      const roundLineCap = startIndex === 0 ? lineWidth / 2 : 0;
      const x = lineLength * startIndex + ((left + roundLineCap) * devicePixelRatio - axialShift);

      const y = h - (values[i] / (maxValue || previewMaxValue)) * h + top * devicePixelRatio;

      const rX = (0.5 + x) | 0;
      const rY = (0.5 + y) | 0;

      if (startIndex === 0) {
        const items = new Array(rateLimit(Math.ceil(left / lineLength), 0));

        if (items.length > 0) {
          let extraX = x;
          let extraY = y;

          ctx.beginPath();
          for (let index = 0; index < items.length; index++) {
            const x1 = x - lineLength * (index + 1);
            const y1 = h - (values[i - (index + 1)] / (maxValue || previewMaxValue)) * h + top * devicePixelRatio;

            if (index === 0) {
              ctx.lineTo(extraX, extraY);
            }

            ctx.lineTo(x1, y1);
            extraX = x1;
            extraY = y1;
          }
          ctx.stroke();
        }
      }

      ctx.beginPath();

      if (startIndex > 0) {
        ctx.moveTo(prevX, prevY);
      }

      ctx.lineTo(rX, rY);
      prevX = rX;
      prevY = rY;

      ctx.stroke();
      startIndex += 1;
      if (Math.ceil(to + 2) < i) {
        break;
      }
    }

    ctx.restore();
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
    const { panelX, panelW, maxValue: prevMaxValue, lineLength, data, savedData } = this;

    const isDisabled = this.disabledLines.some(item => item === name);
    if (isDisabled) {
      this.disabledLines = this.disabledLines.filter(item => item !== name);
    } else {
      this.disabledLines.push(name);
    }

    const nextData = savedData.filter(({ name }) => !this.disabledLines.some(s => s === name));

    this.clearAllCanvases();

    const prevPreviewMaxValue = getMaxValueFromTo({ data, from: 0, to: getDataMaxLength(data) });
    const nextPreviewMaxValue = getMaxValueFromTo({
      data: nextData,
      from: 0,
      to: getDataMaxLength(nextData),
    });

    const { from, to, maxValue: nextMaxValue } = this.getGrab({
      nextData,
      x: panelX,
      panelWidth: panelW,
    });

    this.slide({
      nextData,
      deletion: !isDisabled,
      nextName: name,
      prevMaxValue,
      nextMaxValue,
      prevPreviewMaxValue,
      nextPreviewMaxValue,
      from,
      to,
      nextX: panelX,
      panelW,
      lineLength,
      withPreview: true,
      withoutThrottled: true,
    });

    this.data = nextData;
  }

  clearAllCanvases(withoutXAxis = false) {
    const { nodes } = this;

    for (let key in nodes) {
      const { node, backNode } = nodes[key];
      if (key !== "container") {
        if (withoutXAxis && key === "canvas") {
          this.clearCanvas(node, withoutXAxis);
          this.clearCanvas(node, withoutXAxis);
        } else {
          this.clearCanvas(node);
          this.clearCanvas(backNode);
        }
      }
    }
  }

  appendNodes() {
    const { data, nodes, header } = this;

    let container = null;

    for (let key in nodes) {
      const { node, backNode } = nodes[key];
      node.classList.add(`${this.classNamePrefix}-${key}`);
      if (key !== "container" && container) {
        nodes[key].ctx = node.getContext("2d");
        nodes[key].backCtx = backNode.getContext("2d");
        container.appendChild(node);
      } else {
        container = node;
        this.root.appendChild(node);
        if (header) {
          const node = document.createElement("div");
          node.innerHTML = header;
          node.classList.add(`${this.classNamePrefix}-header`);
          container.appendChild(node);
        }
      }
    }

    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      if (item.type === "line") {
        this.initControl(item);
      }
    }
  }

  handleResize() {
    this.resizeNodes();
    this.overdraw();
  }

  resizeNodes() {
    const { nodes, devicePixelRatio } = this;
    let container = null;

    for (let key in nodes) {
      const { node, height, backNode } = nodes[key];
      if (key !== "container" && container) {
        const { width } = container.getBoundingClientRect();

        node.style.width = width + "px";
        node.style.height = height + "px";
        node.setAttribute("width", width * devicePixelRatio);
        node.setAttribute("height", height * devicePixelRatio);

        if (backNode) {
          backNode.style.width = width + "px";
          backNode.style.height = height + "px";
          backNode.setAttribute("width", width * devicePixelRatio);
          backNode.setAttribute("height", height * devicePixelRatio);
        }
      } else {
        container = node;
      }
    }
  }

  setListeners() {
    const {
      nodes: {
        canvas: { node: canvas },
        previewCanvas: { node: previewCanvas },
      },
    } = this;
    document.addEventListener("mousemove", this.handleMove.bind(this));
    document.addEventListener("touchmove", this.handleMove.bind(this));
    previewCanvas.addEventListener("mousedown", this.handleDown.bind(this));
    previewCanvas.addEventListener("touchstart", this.handleDown.bind(this));
    document.addEventListener("mouseup", this.handleUp.bind(this));
    document.addEventListener("touchend", this.handleUp.bind(this));
    canvas.addEventListener("mousemove", this.handleMoveInChart.bind(this));
    canvas.addEventListener("touchmove", this.handleMoveInChart.bind(this));
    canvas.addEventListener("mouseleave", this.handleLeaveChart.bind(this));
    canvas.addEventListener("touchstart", this.handleMoveInChart.bind(this));
    canvas.addEventListener("touchend", this.handleLeaveChart.bind(this));
    if (window.orientation > -1) {
      window.addEventListener("orientationchange", this.handleResize.bind(this));
    } else {
      window.addEventListener("resize", this.handleResize.bind(this));
    }
  }

  clearCanvas(canvas, withoutXAxis) {
    if (!canvas) return;
    const { offset, devicePixelRatio } = this;

    const ctx = canvas.getContext("2d");
    if (withoutXAxis) {
      const { height } = this.getWithHeigthByRatio(canvas);
      ctx.clearRect(0, 0, canvas.width, height - offset.bottom * devicePixelRatio);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  getPanelWidth() {
    const { nodes, data, lineLength } = this;
    const { canvas, previewCanvas } = nodes;

    const { width: canvasWidth } = this.getWithHeigthByRatio(canvas.node);

    const { width: previewCanvasWidth } = this.getWithHeigthByRatio(previewCanvas.node);

    const lineLengthPreviewCanvas = getLineLength(data, previewCanvasWidth);

    const panelWidth = (canvasWidth / lineLength) * lineLengthPreviewCanvas;

    return panelWidth;
  }

  getPanelRect(e) {
    const { panelW, controlBorderWidth, nodes, offset, panelX, devicePixelRatio } = this;
    const {
      previewCanvas: { node: previewCanvas },
    } = nodes;
    const { left } = offset;

    const { top } = previewCanvas.getBoundingClientRect();
    const { height } = this.getWithHeigthByRatio(previewCanvas);

    if (e.type === "touchstart" || e.type === "touchmove" || e.type === "touchend") {
      return [
        panelX + (left + controlBorderWidth) * devicePixelRatio,
        top * devicePixelRatio,
        panelX + panelW + (left - controlBorderWidth) * devicePixelRatio,
        top * devicePixelRatio + height,
      ];
    } else {
      return [
        panelX + (left + controlBorderWidth) * devicePixelRatio,
        0,
        panelX + panelW + (left - controlBorderWidth) * devicePixelRatio,
        height,
      ];
    }
  }

  resizePanel(x, width) {
    const { startPanelResize, panelX, panelW } = this;
    const isRightBorder = startPanelResize > panelX + panelW;
    const positionX = x - startPanelResize;
    const opposite = isRightBorder ? positionX + panelW < 0 : panelW - positionX > 0;
    const rPanelX = positionX + panelW < 0 ? panelX + positionX + panelW : panelX;
    const lPanelX = panelW - positionX > 0 ? panelX + positionX : panelX + panelW;
    const panelXPos = isRightBorder ? rPanelX : lPanelX;
    const pW = isRightBorder ? Math.abs(positionX + panelW) : Math.abs(panelW - positionX);

    const limitWidth = opposite ? pW + rateLimit(panelXPos, 0) : width - rateLimit(panelXPos, 0);

    return {
      pX: rateLimit(panelXPos, 0),
      pW: panelXPos > 0 ? rateLimit(pW, 0, limitWidth) : rateLimit(pW + panelXPos, 0, limitWidth),
    };
  }

  animateXAxis({ nextLabelDivider, prevLabelDivider, canvas }) {
    const { duration, offset, labelWidthLimit, devicePixelRatio } = this;
    const { bottom } = offset;
    const { height } = this.getWithHeigthByRatio(canvas);
    this.labelDivider = nextLabelDivider;

    const ctx = canvas.getContext("2d");

    this.animate({
      duration,
      timing: linear,
      draw: (progress, { props }) => {
        const { lineLength, from, to, axialShift } = props;
        ctx.clearRect(0, height - bottom * devicePixelRatio, canvas.width, bottom * devicePixelRatio);
        const outProgress = 1 - progress;

        const labelPx = labelWidthLimit / 2;
        const labelX = nextLabelDivider > prevLabelDivider ? -(labelPx * progress) : -labelPx + labelPx * progress;
        const alphaLabel = nextLabelDivider > prevLabelDivider ? outProgress : progress;

        if (nextLabelDivider > prevLabelDivider) {
          this.drawXAxis({
            from,
            to,
            axialShift,
            next: nextLabelDivider,
            divider: prevLabelDivider,
            lineLength,
            labelX,
            alpha: alphaLabel,
          });
        } else {
          this.drawXAxis({
            from,
            to,
            axialShift,
            next: prevLabelDivider,
            divider: nextLabelDivider,
            lineLength,
            labelX,
            alpha: alphaLabel,
          });
        }
      },
    });
  }

  animateYAxis({
    canvas,
    dataForAnimation,
    nextName,
    prevMaxValue,
    nextMaxValue,
    prevPreviewMaxValue,
    nextPreviewMaxValue,
    withPreview,
    nextData,
    deletion,
  }) {
    const {
      data,
      offset: { bottom },
      devicePixelRatio,
      ticks,
      duration,
    } = this;

    const { height: canvasHeight } = this.getWithHeigthByRatio(canvas);
    this.maxValue = nextMaxValue;

    const gridH = (canvasHeight - bottom * devicePixelRatio) / ticks / 2;

    this.animate({
      duration,
      timing: easeInQuad,
      draw: (progress, { props }) => {
        if (progress >= 1) {
          this.animationY = false;
        } else {
          this.animationY = true;
        }

        const { panelX, panelW, lineLength, from, to, axialShift } = props;

        const direction = prevMaxValue < nextMaxValue ? 1 : -1;
        const previewDirection = prevPreviewMaxValue < nextPreviewMaxValue ? 1 : -1;
        const slideOut = direction < 0 ? gridH * progress : -gridH * progress;
        const slideIn = direction < 0 ? -gridH + gridH * progress : gridH - gridH * progress;

        if (withPreview) {
          this.clearAllCanvases(true);
        } else {
          this.clearCanvas(canvas, true);
        }

        const outProgress = 1 - progress;

        if (prevMaxValue !== nextMaxValue) {
          if (nextData.length > 1) {
            // in
            this.drawYAxis({ progress, translateY: slideIn, max: nextMaxValue });
          }
          if (data.length > 1) {
            // out
            this.drawYAxis({ progress: outProgress, translateY: slideOut, max: prevMaxValue });
          }
        } else {
          this.drawYAxis();
        }

        const diff = direction < 0 ? prevMaxValue - nextMaxValue : -(nextMaxValue - prevMaxValue);
        const slideY = prevMaxValue - diff * progress;
        const previewDiff = previewDirection < 0 ? prevPreviewMaxValue - nextPreviewMaxValue : -(nextPreviewMaxValue - prevPreviewMaxValue);
        const slideYPreview = prevPreviewMaxValue - previewDiff * progress;

        this.redraw({
          nextName,
          alpha: deletion ? outProgress : progress,
          data: dataForAnimation,
          panelX,
          panelW,
          from,
          to,
          withPreview,
          maxValue: slideY,
          previewMaxValue: slideYPreview,
          axialShift,
          lineLength,
        });
      },
    });
  }

  slide({
    nextData,
    prevMaxValue,
    nextMaxValue,
    prevPreviewMaxValue,
    nextPreviewMaxValue,
    from,
    to,
    nextX,
    panelW,
    lineLength,
    withPreview = false,
    name,
    deletion,
    nextName,
    nextLabelDivider,
    withoutThrottled,
  } = {}) {
    const {
      data,
      offset: { bottom },
      nodes: {
        canvas: { node: canvas, ctx },
      },
      labelDivider: prevLabelDivider,
      devicePixelRatio,
    } = this;

    const dataForAnimation = deletion ? data : nextData;

    const axialShift = getAxialShift(lineLength, from);

    this.props = {
      panelX: nextX,
      panelW: panelW,
      from,
      to,
      axialShift,
      lineLength,
    };

    const maxValueIsChanged = prevMaxValue !== nextMaxValue;
    const chartsDataIsChanged = nextName;
    const labelIsChanged = nextLabelDivider && prevLabelDivider !== nextLabelDivider;

    const { height } = this.getWithHeigthByRatio(canvas);

    if (labelIsChanged) {
      const props = { prevLabelDivider, nextLabelDivider, canvas, prevMaxValue, nextMaxValue };
      if (withoutThrottled) {
        this.animateXAxis(props);
      } else {
        this.animateXAxisThrottled(props);
      }
    } else {
      ctx.clearRect(0, height - bottom * devicePixelRatio, canvas.width, bottom * devicePixelRatio);
      this.drawXAxis({
        from,
        to,
        axialShift,
        divider: prevLabelDivider,
        lineLength,
      });
    }

    if (maxValueIsChanged || chartsDataIsChanged) {
      const props = {
        dataForAnimation,
        canvas,
        deletion,
        nextName,
        prevMaxValue,
        nextMaxValue,
        prevPreviewMaxValue,
        nextPreviewMaxValue,
        withPreview,
        nextData,
      };

      if (withoutThrottled) {
        this.animationY = true;
        this.animateYAxis(props);
      } else {
        this.animationY = true;
        this.animateYAxisThrottled(props);
      }
    } else {
      this.clearCanvas(canvas, true);

      if (dataForAnimation.length > 1) {
        this.drawYAxis();
      }

      this.redraw({
        data: dataForAnimation,
        panelX: nextX,
        panelW: panelW,
        from,
        to,
        withPreview: false,
        maxValue: nextMaxValue,
        axialShift,
      });
    }
  }

  drawXAxis({ from = 0, to = 1, axialShift = 0, divider = 1, lineLength, labelX = 0, alpha = 1, next } = {}) {
    const {
      data,
      font,
      offset: { bottom, top, left },
      devicePixelRatio,
      theme: { labelColor },
      nodes: {
        canvas: { node: canvas, ctx },
      },
    } = this;

    const labels = data[0].labels;
    const { height } = this.getWithHeigthByRatio(canvas);
    let startIndex = 0;
    const fromInt = Math.floor(from);
    const textPx = 14 * devicePixelRatio;
    const h = height - (bottom + top) * devicePixelRatio;
    ctx.font = `${textPx}px ${font}`;

    const lY = h + (bottom / 2 + top) * devicePixelRatio;
    const lRY = (0.5 + lY) | 0;
    const remainderFrom = fromInt % divider;
    const remainderFromNext = fromInt % next;

    for (let i = fromInt; i < labels.length; i++) {
      const label = labels[i];
      const remainderIndex = startIndex % divider;
      const remainderIndexNext = startIndex % next;
      const x = lineLength * startIndex + (left * devicePixelRatio - axialShift);
      const rX = (0.5 + x) | 0;

      const lastLabel = startIndex === labels.length - fromInt - 1;

      if (lastLabel) {
        ctx.textAlign = "right";
      } else if (i === 0) {
        ctx.textAlign = "left";
      } else {
        ctx.textAlign = "center";
      }

      if (next >= 1 && remainderFromNext + remainderIndexNext === next - 1) {
        ctx.fillStyle = labelColor;
        ctx.fillText(label, rX, lRY);
      } else if (divider >= 1 && remainderFrom + remainderIndex === divider - 1) {
        ctx.fillStyle = hexToRGB(labelColor, alpha);
        ctx.fillText(label, rX - labelX, lRY);
      }

      startIndex += 1;
      if (Math.ceil(to + 2) < i) {
        break;
      }
    }
  }

  handleMove(e) {
    const {
      data,
      labelWidthLimit,
      nodes,
      startPanelGrabbing,
      panelX,
      panelW,
      lineLength,
      startPanelResize,
      devicePixelRatio,
      maxValue: prevMaxValue,
      labelDivider: prevLabelDivider,
    } = this;

    const {
      previewCanvas: { ctx: previewCtx, node: previewCanvasNode, backNode: previewBackNode },
    } = nodes;
    const {
      canvas: { node: canvas },
    } = nodes;
    const { move, leftBorder, rightBorder } = this.insidePanel(e);
    const isNotAction = startPanelGrabbing === null && startPanelResize === null;
    const { x } = getPosition(e, devicePixelRatio);
    const { width: canvasWidth } = this.getWithHeigthByRatio(canvas);
    const { width } = this.getWithHeigthByRatio(previewCanvasNode);

    if (isNotAction && move) {
      previewCanvasNode.style.cursor = "move";
      previewCanvasNode.style.cursor = "-webkit-grab";
      previewCanvasNode.style.cursor = "grab";
    } else if (isNotAction && (leftBorder || rightBorder)) {
      previewCanvasNode.style.cursor = "col-resize";
    } else if (isNumeric(startPanelResize)) {
      // panel resize
      const { pX, pW } = this.resizePanel(x, width);

      this.clearCanvas(previewCanvasNode);
      previewCtx.drawImage(previewBackNode, 0, 0);
      this.fillPreviewCanvas(pX, pW);

      const { from, to, maxValue: nextMaxValue } = this.getGrab({ x: pX, panelWidth: pW });

      const nextLineLength = canvasWidth / (to - from);
      this.lineLength = nextLineLength;
      const nextLabelDivider = getLabelDivider(labelWidthLimit, nextLineLength);

      this.slide({
        nextLabelDivider,
        nextData: data,
        prevMaxValue,
        nextMaxValue,
        from,
        to,
        nextX: pX,
        panelW: pW,
        lineLength: nextLineLength,
      });
    } else if (isNumeric(startPanelGrabbing)) {
      // panel grab
      const positionX = x - startPanelGrabbing;
      const nextX = rateLimit(panelX + positionX, 0, width - panelW);

      this.clearCanvas(previewCanvasNode);

      previewCtx.drawImage(previewBackNode, 0, 0);
      this.fillPreviewCanvas(nextX, panelW);

      const { maxValue: nextMaxValue, from, to } = this.getGrab({
        x: nextX,
        panelWidth: panelW,
      });

      this.slide({
        nextLabelDivider: prevLabelDivider,
        nextData: data,
        prevMaxValue,
        nextMaxValue,
        from,
        to,
        nextX,
        panelW,
        lineLength,
      });
    } else if (isNotAction) {
      previewCanvasNode.style.cursor = "default";
    }
  }

  handleUp(e) {
    const { nodes, startPanelGrabbing, startPanelResize, panelX, devicePixelRatio } = this;
    const { previewCanvas } = nodes;
    const { node: previewCanvasNode } = previewCanvas;

    const { left } = previewCanvasNode.getBoundingClientRect();
    const { x } = getPosition(e, devicePixelRatio);
    const { width } = this.getWithHeigthByRatio(previewCanvasNode);
    const offsetLeft = e.type === "touchend" ? left * devicePixelRatio : 0;

    if (isNumeric(startPanelGrabbing)) {
      const positionX = x - startPanelGrabbing - offsetLeft;
      this.panelX = rateLimit(panelX + positionX, 0, width - this.panelW);

      this.startPanelGrabbing = null;
      document.documentElement.style.cursor = "";
    } else if (isNumeric(startPanelResize)) {
      const { pX, pW } = this.resizePanel(x - offsetLeft, width);

      this.panelX = pX;
      this.panelW = pW;

      document.documentElement.style.cursor = "";
      this.startPanelResize = null;
    }

    const { move, leftBorder, rightBorder } = this.insidePanel(e);

    if (move) {
      previewCanvas.node.style.cursor = "move";
      previewCanvas.node.style.cursor = "-webkit-grab";
      previewCanvas.node.style.cursor = "grab";
    } else if (leftBorder || rightBorder) {
      previewCanvas.node.style.cursor = "col-resize";
    } else {
      previewCanvas.node.style.cursor = "default";
    }
  }

  handleDown(e) {
    const { devicePixelRatio, nodes } = this;
    const { previewCanvas } = nodes;
    const { x } = getPosition(e);

    const { move, leftBorder, rightBorder } = this.insidePanel(e);

    if (leftBorder || rightBorder) {
      this.startPanelResize = x * devicePixelRatio;
      document.documentElement.style.cursor = "col-resize";
      previewCanvas.node.style.cursor = "col-resize";
    } else if (move) {
      this.startPanelGrabbing = x * devicePixelRatio;
      document.documentElement.style.cursor = "-webkit-grabbing";
      document.documentElement.style.cursor = "grabbing";
      previewCanvas.node.style.cursor = "-webkit-grabbing";
      previewCanvas.node.style.cursor = "grabbing";
    }
  }

  handleMoveInChart(e) {
    const {
      data,
      devicePixelRatio,
      lineLength,
      panelX,
      panelW,
      offset: { left },
      nodes: {
        canvas: { node: canvas, backNode, ctx, backCtx },
      },
      startPanelGrabbing,
      startPanelResize,
      selectedItem,
      animationY,
    } = this;

    if (startPanelGrabbing !== null || startPanelResize !== null || animationY) {
      return;
    }

    const { x } = getPosition(e, devicePixelRatio);
    const { from } = this.getGrab({ x: panelX, panelWidth: panelW, withoutMaxValue: true });
    const index = rateLimit(Math.floor((x - left * devicePixelRatio) / lineLength + from), 0, getDataMaxLength(data) - 1);

    if (selectedItem === null) {
      backCtx.drawImage(canvas, 0, 0);
    }

    if (selectedItem !== null && (selectedItem && selectedItem[0].index === index)) {
      return;
    } else if (selectedItem !== null && (selectedItem && selectedItem[0].index !== index)) {
      this.clearCanvas(canvas);
      ctx.drawImage(backNode, 0, 0);
    }

    const selectedData = [];

    let max = 0;
    selectedData.push({ index });

    for (let i = 0; i < data.length; i++) {
      const { type, values, color, chart } = data[i];
      const value = values[index];
      if (type !== "x") {
        max = Math.max(max, value);
        selectedData.push({
          chart,
          color,
          value,
        });
      } else {
        const datetime = new Date(value);
        const date = datetime.getDate();
        const month = datetime.toLocaleString("en-us", {
          month: "short",
        });
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const dayName = days[datetime.getDay()];
        selectedData.push({
          type,
          value: `${dayName}, ${month}, ${date}`,
        });
      }
    }

    selectedData[0].max = max;

    selectedData.sort((a, b) => b.value - a.value);

    this.selectedItem = selectedData;
    if ((selectedData && selectedData.length < 3) || index < Math.floor(from)) {
      return;
    }

    this.drawTooltip({ index, from });
  }

  drawTooltip({ index, from }) {
    const {
      nodes: {
        canvas: { node: canvas, lineWidth, ctx },
      },
      font,
      theme: { gridLineColor, textColor, tooltipFill, fillColor, tooltipShadowColor },
      maxValue,
      selectedItem,
      lineLength,
      devicePixelRatio,
      offset: { left, bottom, top },
    } = this;

    if (selectedItem === null) {
      return;
    }

    const { width, height } = this.getWithHeigthByRatio(canvas);
    ctx.textAlign = "left";

    const r = 5 * devicePixelRatio;
    const circleLw = 2 * devicePixelRatio;
    const h = height - (bottom + top) * devicePixelRatio;
    const axialShift = getAxialShift(lineLength, from);
    const x = lineLength * (index - Math.floor(from)) + left * devicePixelRatio - axialShift;
    const blankPaddingX = 15 * devicePixelRatio;
    const blankPaddingY = 8 * devicePixelRatio;

    const chartPadding = 5 * devicePixelRatio;
    let blankWidth = blankPaddingX * 2;
    let blankHeight = blankPaddingY * 2 + chartPadding;
    let textPaddingLeft = blankPaddingX;
    let valuesWidth = blankPaddingX * 2;
    const valueFontPx = 18 * devicePixelRatio;
    const chartFontPx = 14 * devicePixelRatio;
    const datePx = 16 * devicePixelRatio;
    let centerX = blankPaddingX;

    const { max } = selectedItem[0];
    let dotYmin = Infinity;

    for (let i = 1; i < selectedItem.length; i++) {
      const item = selectedItem[i];
      const { type, value, chart } = item;

      if (type !== "x") {
        const y = h - (value / maxValue) * h + lineWidth / 2 + top * devicePixelRatio;
        dotYmin = Math.min(y, dotYmin);
        ctx.font = `bold ${valueFontPx}px ${font}`;
        const text = ctx.measureText(value);
        ctx.font = `normal ${chartFontPx}px ${font}`;
        const textBottom = ctx.measureText(chart);
        const isLast = i === selectedItem.length - 1;
        const marginLeft = isLast ? 0 : 20 * devicePixelRatio;

        const itemWidth = Math.max(text.width + marginLeft, textBottom.width + marginLeft);

        valuesWidth += itemWidth;
        if (i === 2) {
          centerX += Math.max(text.width / 2, textBottom.width / 2);
          blankHeight += valueFontPx + chartFontPx;
        }

        item.textX = textPaddingLeft;
        textPaddingLeft += itemWidth;
      } else {
        ctx.font = `bold ${datePx}px ${font}`;
        const dateText = ctx.measureText(value);
        blankWidth += dateText.width;
        blankHeight += datePx + blankPaddingY;
      }
    }

    const rectWidth = Math.max(blankWidth, valuesWidth);
    const rectY = h - (max / maxValue) * h + top * devicePixelRatio;
    const limitedRectY = rateLimit(rectY - blankHeight - (r + circleLw / 2) - blankPaddingY, 0);
    const inDot = limitedRectY + blankHeight > dotYmin;
    const flipX =
      width - x < x ? x - rectWidth + centerX - (r + circleLw / 2) - blankPaddingX : x + centerX + (r + circleLw / 2) + blankPaddingX;

    const flippedX = inDot ? flipX : x;
    const limitedX = rateLimit(flippedX, left * devicePixelRatio + centerX - axialShift, width - rectWidth + centerX + left * devicePixelRatio);

    for (let i = 0; i < selectedItem.length; i++) {
      const { type, value, color } = selectedItem[i];
      const y = h - (value / maxValue) * h + lineWidth / 2 + top * devicePixelRatio;

      if (type !== "x") {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI, false);
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.lineWidth = circleLw;
        ctx.strokeStyle = color;
        ctx.stroke();
      } else {
        const lineYFrom = rateLimit(limitedRectY, dotYmin);

        ctx.beginPath();
        ctx.lineWidth = 1 * devicePixelRatio;
        ctx.strokeStyle = gridLineColor;
        ctx.moveTo(x, height - bottom * devicePixelRatio);
        ctx.lineTo(x, lineYFrom);
        ctx.stroke();
      }
    }

    const dateY = limitedRectY + datePx + blankPaddingY;
    const valueY = limitedRectY + (datePx + blankPaddingY) * 2;
    const chartY = valueY + chartFontPx + chartPadding;

    for (let i = 1; i < selectedItem.length; i++) {
      const { type, value, color, chart, textX } = selectedItem[i];

      if (type !== "x") {
        ctx.fillStyle = color;
        ctx.font = `bold ${valueFontPx}px ${font}`;
        ctx.fillText(numberWithSpaces(value), limitedX + textX - centerX, valueY);
        ctx.font = `normal ${chartFontPx}px ${font}`;
        ctx.fillText(chart, limitedX + textX - centerX, chartY);
      } else {
        ctx.beginPath();
        ctx.save();
        ctx.lineWidth = devicePixelRatio;
        ctx.strokeStyle = "transparent";
        ctx.shadowColor = tooltipShadowColor;
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 2;
        ctx.fillStyle = tooltipFill;

        roundRect({
          canvas,
          x: limitedX - centerX,
          y: limitedRectY,
          w: rectWidth,
          h: blankHeight,
          r: 6,
        });
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        ctx.beginPath();
        ctx.font = `bold ${datePx}px ${font}`;
        ctx.fillStyle = textColor;
        ctx.fillText(value, limitedX + blankPaddingX - centerX, dateY);
        ctx.stroke();
      }
    }
  }

  handleLeaveChart() {
    const {
      startPanelGrabbing,
      startPanelResize,
      nodes: {
        canvas: { node: canvas, backNode, ctx },
      },
    } = this;

    if (startPanelGrabbing !== null || startPanelResize !== null) {
      return;
    }

    if (!isCanvasBlank(backNode)) {
      this.clearCanvas(canvas);
      ctx.drawImage(backNode, 0, 0);
      this.clearCanvas(backNode);
      this.selectedItem = null;
    }
  }

  insidePanel(e) {
    const { controlBorderWidth, devicePixelRatio } = this;
    const { x, y } = getPosition(e, devicePixelRatio);

    const panelReact = this.getPanelRect(e);
    const [xMin, yMin, xMax, yMax] = panelReact;

    const leftBorderRect = [xMin - controlBorderWidth * devicePixelRatio, yMin, xMin + controlBorderWidth * devicePixelRatio, yMax];
    const rightBorderRect = [xMax, yMin, xMax + controlBorderWidth * devicePixelRatio, yMax];

    return {
      leftBorder: isDotInsideRect([x, y], leftBorderRect),
      rightBorder: isDotInsideRect([x, y], rightBorderRect),
      move: isDotInsideRect([x, y], panelReact),
    };
  }

  fillPreviewCanvas(x, panelWidth) {
    const { nodes, controlBorderWidth, offset, devicePixelRatio, theme } = this;
    const { previewFill, previewStroke } = theme;
    const {
      previewCanvas: { node: previewCanvas, ctx },
    } = nodes;
    const { left } = offset;

    const { width, height } = this.getWithHeigthByRatio(previewCanvas);

    ctx.beginPath();
    ctx.fillStyle = previewFill;

    // before
    ctx.rect(left * devicePixelRatio, 0, x, height);
    ctx.fill();

    ctx.beginPath();
    // after
    ctx.rect(x + panelWidth + left * devicePixelRatio + 1 * devicePixelRatio, 0, width - x - panelWidth, height);
    ctx.fill();

    // center
    ctx.beginPath();
    ctx.lineWidth = controlBorderWidth;
    ctx.strokeStyle = previewStroke;
    ctx.rect(x + left * devicePixelRatio + controlBorderWidth / 2, 0, panelWidth - controlBorderWidth + 1 * devicePixelRatio, height);
    ctx.stroke();
  }
}
