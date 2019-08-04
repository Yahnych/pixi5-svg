import dPathParse from "d-path-parser";
import * as PIXI from "pixi.js";
import tcolor from "tinycolor2";
import { parseScientific, arcToBezier, parseTransform } from "./utils";

/**
 * @typedef {Object} DefaultOptions
 * @property {number} [lineWidth] default stroke thickness (must be greater or equal of 1)
 * @property {number} [lineColor] default stroke color
 * @property {number} [lineOpacity] default stroke opacity
 * @property {number} [fillColor] default fill color
 * @property {number} [fillOpacity] default fill opacity
 * @property {boolean} [unpackTree] unpack node tree, otherwise build single Graphics
 */

const tmpPoint = new PIXI.Point();

const DEFAULT = {
	unpackTree: false,
	lineColor: 0,
	lineOpacity: 1,
	fillColor: 0,
	fillOpacity: 1,
	lineWidth: 1
};

export default class SVG extends PIXI.Graphics {
	/**
	 * Create Graphics from svg
	 * @class
	 * @public
	 * @param {SVGElement | string} svg
	 * @param {DefaultOptions} options
	 */
	constructor(svg, options = DEFAULT) {
		super();
		this.options = Object.assign({}, DEFAULT, options || {});

		if (!(svg instanceof SVGElement)) {
			const container = document.createElement("div");
			container.innerHTML = svg;

			//@ts-ignore
			svg = container.children[0];
			if (!(svg instanceof SVGElement)) {
				throw new Error("invalid SVG!");
			}
		}

		//@ts-ignore
		this.svgChildren(svg.children);
		this.type = "";
	}

	/**
	 * Get `GraphicsData` under cursor if available. Similar as `containsPoint`, but return internal `GraphicsData`
	 * @public
	 * @method SVG#pickGraphicsData
	 * @param {PIXI.Point} point - global point for intersection checking
	 * @param {boolean} all - Include all intersected, otherwise first selected if exist
	 * @return {Array<PIXI.GraphicsData>}  list of selected GraphicsData, can be empty or grater that 1
	 */
	pickGraphicsData(point, all) {
		let picked = [];

		point = this.worldTransform.applyInverse(point);

		//@ts-ignore
		const graphicsData = this.geometry.graphicsData;

		for (let i = 0; i < graphicsData.length; ++i) {
			const data = graphicsData[i];

			if (!data.fillStyle.visible || !data.shape) {
				continue;
			}
			if (data.matrix) {
				data.matrix.applyInverse(point, tmpPoint);
			} else {
				tmpPoint.copyFrom(point);
			}

			if (data.shape.contains(tmpPoint.x, tmpPoint.y)) {
				let skip = false;
				if (data.holes) {
					for (let i = 0; i < data.holes.length; i++) {
						const hole = data.holes[i];
						if (hole.shape.contains(tmpPoint.x, tmpPoint.y)) {
							skip = true;
							break;
						}
					}
				}

				if (!skip) {
					if (!all) {
						return [data];
					} else {
						picked.push(data);
					}
				}
			}
		}

		return picked;
	}

	/**
	 * Parse transform attribute
	 * @private
	 * @method SVG#parseTransform
	 * @param {SVGElement} node
	 */
	svgTransform(node) {
		if (!node.getAttribute("transform")) return undefined;

		const matrix = new PIXI.Matrix();
		const transformAttr = node.getAttribute("transform");
		const commands = parseTransform(transformAttr);

		//apply transform matrix right to left
		for (let key = commands.length - 1; key >= 0; --key) {
			let command = commands[key].command;
			let values = commands[key].params;

			switch (command) {
				case "matrix": {
					matrix.a = parseScientific(values[0]);
					matrix.b = parseScientific(values[1]);
					matrix.c = parseScientific(values[2]);
					matrix.d = parseScientific(values[3]);
					matrix.tx = parseScientific(values[4]);
					matrix.ty = parseScientific(values[5]);

					return matrix;
				}
				case "translate": {
					const dx = parseScientific(values[0]);
					const dy = parseScientific(values[1]) || 0;
					matrix.translate(dx, dy);
					break;
				}
				case "scale": {
					const sx = parseScientific(values[0]);
					const sy = values.length > 1 ? parseScientific(values[1]) : sx;
					matrix.scale(sx, sy);
					break;
				}
				case "rotate": {
					let dx = 0;
					let dy = 0;

					if (values.length > 1) {
						dx = parseScientific(values[1]);
						dy = parseScientific(values[2]);
					}

					matrix
						.translate(-dx, -dy)
						.rotate((parseScientific(values[0]) * Math.PI) / 180)
						.translate(dx, dy);

					break;
				}
				default: {
					console.log(`Command ${command} can't implement yet`);
				}
			}
		}

		return matrix;
	}

	/**
	 * Create a PIXI Graphic from SVG element
	 * @private
	 * @method SVG#svgChildren
	 * @param {Array<*>} children - Collection of SVG nodes
	 * @param {*} [parentStyle=undefined] Whether to inherit fill settings.
	 * @param {PIXI.Matrix} [parentMatrix=undefined] Matrix fro transformations
	 */
	svgChildren(children, parentStyle, parentMatrix) {
		for (let i = 0; i < children.length; i++) {
			const child = children[i];
			const shape = this.options.unpackTree ? new SVG(child, this.options) : this;

			const nodeName = child.nodeName.toLowerCase();
			const nodeStyle = this.svgStyle(child);
			const matrix = this.svgTransform(child);

			//compile full style inherited from all parents
			const fullStyle = Object.assign({}, parentStyle || {}, nodeStyle);

			shape.fillShapes(child, fullStyle, matrix);

			switch (nodeName) {
				case "path": {
					//console.log(child.getAttribute("id"), {...fullStyle});
					shape.svgPath(child);
					break;
				}
				case "circle":
				case "ellipse": {
					shape.svgCircle(child);
					break;
				}
				case "rect": {
					shape.svgRect(child);
					break;
				}
				case "polygon": {
					shape.svgPoly(child, true);
					break;
				}
				case "polyline": {
					shape.svgPoly(child, false);
					break;
				}
				case "g": {
					break;
				}
				default: {
					// @if DEBUG
					console.info("[SVGUtils] <%s> elements unsupported", child.nodeName);
					// @endif
					break;
				}
			}

			shape.svgChildren(child.children, fullStyle, matrix);
			if (this.options.unpackTree) {
				shape.name = child.getAttribute("id") || "child_" + i;
				shape.type = nodeName;
				this.addChild(shape);
			}
		}
	}

	/**
	 * Convert the Hexidecimal string (e.g., "#fff") to uint
	 * @private
	 * @method SVG#hexToUint
	 */
	hexToUint(hex) {
		if (hex === undefined || hex === null) return;

		if (hex[0] === "#") {
			// Remove the hash
			hex = hex.substr(1);

			// Convert shortcolors fc9 to ffcc99
			if (hex.length === 3) {
				hex = hex.replace(/([a-f0-9])/gi, "$1$1");
			}
			return parseInt(hex, 16);
		} else {
			const rgb = tcolor(hex).toRgb();

			return (rgb.r << 16) + (rgb.g << 8) + rgb.b;
		}
	}

	/**
	 * Render a <ellipse> element or <circle> element
	 * @private
	 * @method SVG#internalEllipse
	 * @param {SVGCircleElement} node
	 */
	svgCircle(node) {
		let heightProp = "r";
		let widthProp = "r";
		const isEllipse = node.nodeName === "ellipse";
		if (isEllipse) {
			heightProp += "x";
			widthProp += "y";
		}
		const width = parseFloat(node.getAttribute(widthProp));
		const height = parseFloat(node.getAttribute(heightProp));
		const cx = node.getAttribute("cx") || "0";
		const cy = node.getAttribute("cy") || "0";
		let x = 0;
		let y = 0;
		if (cx !== null) {
			x = parseFloat(cx);
		}
		if (cy !== null) {
			y = parseFloat(cy);
		}
		if (!isEllipse) {
			this.drawCircle(x, y, width);
		} else {
			this.drawEllipse(x, y, width, height);
		}
	}

	/**
	 * Render a <rect> element
	 * @private
	 * @method SVG#svgRect
	 * @param {SVGRectElement} node
	 */
	svgRect(node) {
		const x = parseFloat(node.getAttribute("x")) || 0;
		const y = parseFloat(node.getAttribute("y")) || 0;
		const width = parseFloat(node.getAttribute("width"));
		const height = parseFloat(node.getAttribute("height"));
		const rx = parseFloat(node.getAttribute("rx"));
		if (rx) {
			this.drawRoundedRect(x, y, width, height, rx);
		} else {
			this.drawRect(x, y, width, height);
		}
	}

	/**
	 * Get the style property and parse options.
	 * @private
	 * @method SVG#svgStyle
	 * @param {SVGElement} node
	 * @return {Object} Style attributes
	 */
	svgStyle(node) {
		const style = node.getAttribute("style");
		const result = {
			fill: node.getAttribute("fill"),
			opacity: node.getAttribute("opacity"),
			fillOpacity: node.getAttribute("fill-opacity"),
			stroke: node.getAttribute("stroke"),
			strokeOpacity: node.getAttribute("stroke-opacity"),
			strokeWidth: node.getAttribute("stroke-width")
		};
		if (style !== null) {
			style.split(";").forEach(prop => {
				const [name, value] = prop.split(":");
				result[name.trim()] = value.trim();
			});
			if (result["stroke-width"]) {
				result.strokeWidth = result["stroke-width"];
				delete result["stroke-width"];
			}
		}

		for (let key in result) {
			if (result[key] === null) {
				delete result[key];
			}
		}
		return result;
	}

	/**
	 * Render a polyline element.
	 * @private
	 * @method SVG#svgPoly
	 * @param {SVGPolylineElement} node
	 */
	svgPoly(node, close) {
		const points = node
			.getAttribute("points")
			.split(/[ ,]/g)
			.map(p => parseFloat(p));

		this.drawPolygon(points);

		if (close) {
			this.closePath();
		}
	}

	/**
	 * Set the fill and stroke style.
	 * @private
	 * @method SVG#fillShapes
	 * @param {SVGElement} node
	 * @param {*} style
	 * @param {PIXI.Matrix} matrix
	 */
	fillShapes(node, style, matrix) {
		const { fill, opacity, stroke, strokeWidth, strokeOpacity, fillOpacity } = style;

		const defaultLineWidth = stroke !== undefined ? this.options.lineWidth || 1 : 0;
		const lineWidth = strokeWidth !== undefined ? Math.max(0.5, parseFloat(strokeWidth)) : defaultLineWidth;
		const lineColor = stroke !== undefined ? this.hexToUint(stroke) : this.options.lineColor;

		const strokeOpacityValue =
			opacity !== undefined ? parseFloat(opacity) : strokeOpacity !== undefined ? parseFloat(strokeOpacity) : 1;

		const fillOpacityValue =
			opacity !== undefined ? parseFloat(opacity) : fillOpacity !== undefined ? parseFloat(fillOpacity) : 1;

		if (fill) {
			if (fill === "none" || fill === "transparent") {
				this.beginFill(0, 0);
			} else {
				this.beginFill(this.hexToUint(fill), fillOpacityValue);
			}
		} else {
			this.beginFill(this.options.fillColor, 1);
		}

		this.lineStyle(lineWidth, lineColor, strokeOpacityValue);
		this.setMatrix(matrix);

		// @if DEBUG
		if (node.getAttribute("stroke-linejoin")) {
			console.info('[SVGUtils] "stroke-linejoin" attribute is not supported');
		}
		if (node.getAttribute("stroke-linecap")) {
			console.info('[SVGUtils] "stroke-linecap" attribute is not supported');
		}
		if (node.getAttribute("fill-rule")) {
			console.info('[SVGUtils] "fill-rule" attribute is not supported');
		}
		// @endif
	}

	/**
	 * Render a <path> d element
	 * @method SVG#svgPath
	 * @param {SVGPathElement} node
	 */
	svgPath(node) {
		const d = node.getAttribute("d");
		let x = 0,
			y = 0;
		const commands = dPathParse(d);
		let prevCommand = undefined;

		for (var i = 0; i < commands.length; i++) {
			const command = commands[i];

			switch (command.code) {
				case "m": {
					this.moveTo((x += command.end.x), (y += command.end.y));
					break;
				}
				case "M": {
					this.moveTo((x = command.end.x), (y = command.end.y));
					break;
				}
				case "H": {
					this.lineTo((x = command.value), y);
					break;
				}
				case "h": {
					this.lineTo((x += command.value), y);
					break;
				}
				case "V": {
					this.lineTo(x, (y = command.value));
					break;
				}
				case "v": {
					this.lineTo(x, (y += command.value));
					break;
				}
				case "Z":
				case "z": {
					//jump corete to end
					this.closePath();
					break;
				}
				case "L": {
					this.lineTo((x = command.end.x), (y = command.end.y));
					break;
				}
				case "l": {
					this.lineTo((x += command.end.x), (y += command.end.y));
					break;
				}
				//short C, selet cp1 from last command
				case "S": {
					let cp1 = { x, y };
					let cp2 = command.cp;

					//S is compute points from old points
					if (prevCommand.code == "S" || prevCommand.code == "C") {
						const lc = prevCommand.cp2 || prevCommand.cp;
						cp1.x = 2 * prevCommand.end.x - lc.x;
						cp1.y = 2 * prevCommand.end.y - lc.y;
					} else {
						cp1 = cp2;
					}

					this.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, (x = command.end.x), (y = command.end.y));
					break;
				}
				case "C": {
					const cp1 = command.cp1;
					const cp2 = command.cp2;

					this.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, (x = command.end.x), (y = command.end.y));
					break;
				}
				//diff!!
				//short C, select cp1 from last command
				case "s": {
					const currX = x;
					const currY = y;

					let cp1 = { x, y };
					let cp2 = command.cp;

					//S is compute points from old points
					if (prevCommand.code == "s" || prevCommand.code == "c") {
						const lc = prevCommand.cp2 || prevCommand.cp;
						cp1.x = prevCommand.end.x - lc.x;
						cp1.y = prevCommand.end.y - lc.y;
					} else {
						this.quadraticCurveTo(currX + cp2.x, currY + cp2.y, (x += command.end.x), (y += command.end.y));
						break;
					}

					this.bezierCurveTo(
						currX + cp1.x,
						currY + cp1.y,
						currX + cp2.x,
						currY + cp2.y,
						(x += command.end.x),
						(y += command.end.y)
					);
					break;
				}
				case "c": {
					const currX = x;
					const currY = y;
					const cp1 = command.cp1;
					const cp2 = command.cp2;

					this.bezierCurveTo(
						currX + cp1.x,
						currY + cp1.y,
						currX + cp2.x,
						currY + cp2.y,
						(x += command.end.x),
						(y += command.end.y)
					);
					break;
				}
				case "t": {
					let cp = command.cp || { x, y };
					let prevCp = { x, y };

					if (prevCommand.code != "t" || prevCommand.code != "q") {
						prevCp = prevCommand.cp || prevCommand.cp2 || prevCommand.end;
						cp.x = prevCommand.end.x - prevCp.x;
						cp.y = prevCommand.end.y - prevCp.y;
					} else {
						this.lineTo((x += command.end.x), (y += command.end.y));
						break;
					}

					const currX = x;
					const currY = y;

					this.quadraticCurveTo(currX + cp.x, currY + cp.y, (x += command.end.x), (y += command.end.y));
					break;
				}
				case "q": {
					const currX = x;
					const currY = y;

					this.quadraticCurveTo(
						currX + command.cp.x,
						currY + command.cp.y,
						(x += command.end.x),
						(y += command.end.y)
					);
					break;
				}

				case "T": {
					let cp = command.cp || { x, y };
					let prevCp = { x, y };

					if (prevCommand.code != "T" || prevCommand.code != "Q") {
						prevCp = prevCommand.cp || prevCommand.cp2 || prevCommand.end;
						cp.x = 2 * prevCommand.end.x - prevCp.x;
						cp.y = 2 * prevCommand.end.y - prevCp.y;
					} else {
						this.lineTo((x = command.end.x), (y = command.end.y));
						break;
					}

					this.quadraticCurveTo(cp.x, cp.y, (x = command.end.x), (y = command.end.y));
					break;
				}

				case "Q": {
					let cp = command.cp;
					this.quadraticCurveTo(cp.x, cp.y, (x = command.end.x), (y = command.end.y));
					break;
				}

				//arc as bezier
				case "a":
				case "A": {
					const currX = x;
					const currY = y;

					if (command.relative) {
						x += command.end.x;
						y += command.end.y;
					} else {
						x = command.end.x;
						y = command.end.y;
					}
					const beziers = arcToBezier({
						x1: currX,
						y1: currY,
						rx: command.radii.x,
						ry: command.radii.y,
						x2: x,
						y2: y,
						phi: command.rotation,
						fa: command.large,
						fs: command.clockwise
					});
					for (let b of beziers) {
						this.bezierCurveTo(b[2], b[3], b[4], b[5], b[6], b[7]);
					}
					break;
				}
				default: {
					console.info("[SVGUtils] Draw command not supported:", command.code, command);
				}
			}

			//save previous command fro C S and Q
			prevCommand = command;
		}
	}
}