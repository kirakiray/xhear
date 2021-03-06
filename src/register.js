// 注册数据
const regDatabase = new Map();

const RUNARRAY = Symbol("runArray");

// 渲染结束标记
const RENDEREND = Symbol("renderend"), RENDEREND_RESOLVE = Symbol("renderend_resove"), RENDEREND_REJECT = Symbol("renderend_reject");

const ATTRBINDINGKEY = "attr" + getRandomId();

// 是否表达式
const isFunctionExpr = (str) => { argsWReg.lastIndex = 0; return argsWReg.test(str.trim()) };

// 转化为指向this的函数表达式
const argsWReg = /(".*?"|'.*?'|\(|\)|\[|\]|\{|\}|\|\||\&\&|\?|\!|:| |\+|\-|\*|%|\,|\<|\>)/g;

const argsWReg_c = /(".*?"|'.*?'|\(|\)|\[|\]|\{|\}|\|\||\&\&|\?|\!|:| |\+|\-|\*|%|\,|[\<\>\=]?[=]?=|\<|\>)/;
const ignoreArgKeysReg = /(^\$event$|^\$args$|^debugger$|^console\.|^Number$|^String$|^Object$|^Array$|^parseInt$|^parseFloat$|^undefined$|^null$|^true$|^false$|^[\d])/;

const argsWithThis = (expr) => {
    // 替换字符串用的唯一key
    const sKey = "$$" + getRandomId() + "_";

    let jump_strs = [];

    // 规避操作
    let before_expr = expr.replace(/\? *[\w]+?:/g, e => {
        let replace_key = "__" + getRandomId() + "__";

        jump_strs.push({
            k: replace_key,
            v: e
        });

        return replace_key;
    });

    // 先抽取json结构的Key，防止添加this，后面再补充回去
    let after_expr = before_expr.replace(/[\w]+? *:/g, (e) => {
        return `${sKey}${e}`;
    });

    // 还原规避字符串
    jump_strs.forEach(e => {
        after_expr = after_expr.replace(e.k, e.v);
    });

    // 针对性的进行拆分
    let argsSpArr = after_expr.split(argsWReg).map(e => {
        if (e.includes(sKey)) {
            return e.replace(sKey, "");
        }
        if (argsWReg_c.test(e) || !e.trim() || /^\./.test(e) || ignoreArgKeysReg.test(e)) {
            return e;
        }
        return `this.${e}`;
    });

    return argsSpArr.join("");
}

// 使用with性能不好，所以将内部函数变量转为指向this的函数
const funcExprWithThis = (expr) => {
    let new_expr = "";

    let w_arr = expr.split(";").filter(e => !!e);

    if (w_arr.length > 1) {
        w_arr.forEach(e => {
            new_expr += "\n" + argsWithThis(e) + ";";
        });
    } else {
        new_expr = `return ${argsWithThis(w_arr[0])}`;
    }

    return new_expr;
}

// 获取函数
const exprToFunc = (expr) => {
    // 最后测试使用with性能不会差太多
    return new Function("...args", `
    const $event = args[0];
    const $args = args;
    args = undefined;

    try{
        ${funcExprWithThis(expr)}
    }catch(e){
    let ele = this.ele;
    if(!ele && this.$host){
        ele = this.$host.ele;
    }
    let errObj = {
        expr:'${expr.replace(/'/g, "\\'").replace(/"/g, '\\"')}',
        target:ele,
        error:e
    }
    ele && ele.__xInfo && Object.assign(errObj,ele.__xInfo);
    console.error(errObj);
    }
            `);

    // return new Function("...args", `
    // const $event = args[0];
    // const $args = args;
    // args = undefined;
    // with(this){
    //     try{
    //         return ${expr}
    //     }catch(e){
    //         let ele = this.ele;
    //         if(!ele && this.$host){
    //             ele = this.$host.ele;
    //         }
    //         let errObj = {
    //             expr:'${expr.replace(/'/g, "\\'").replace(/"/g, '\\"')}',
    //             target:ele,
    //             error:e
    //         }
    //         ele && ele.__xInfo && Object.assign(errObj,ele.__xInfo);
    //         console.error(errObj);
    //     }
    // }
    //     `);
}

const register = (opts) => {
    let defaults = {
        // 自定义标签名
        tag: "",
        // 正文内容字符串
        temp: "",
        // 和attributes绑定的keys
        attrs: [],
        // 默认数据
        data: {},
        // 直接监听属性变动对象
        watch: {},
        // 原型链上的方法
        // proto: {},
        // 初始化完成后触发的事件
        // ready() {},
        // 添加进document执行的callback
        // attached() {},
        // 删除后执行的callback
        // detached() {}
    };

    Object.assign(defaults, opts);

    let attrs = defaults.attrs;

    let attrsType = getType(attrs);
    if (attrsType == "object") {
        // 修正数据
        let n_attrs = Object.keys(attrs);

        n_attrs.forEach(attrName => {
            defaults.data[attrToProp(attrName)] = attrs[attrName];
        });

        attrs = defaults.attrs = n_attrs.map(e => attrToProp(e));
    } else if (attrsType == "array") {
        // 修正属性值
        attrs = defaults.attrs = attrs.map(e => attrToProp(e));
    }

    defaults.data = cloneObject(defaults.data);
    defaults.watch = Object.assign({}, defaults.watch);

    // 转换tag
    let tag = defaults.tag = propToAttr(defaults.tag);

    // 自定义元素
    const CustomXhearEle = class extends XhearEle {
        constructor(...args) {
            super(...args);

            // 挂载渲染状态机
            this[RENDEREND] = new Promise((resolve, reject) => {
                this[RENDEREND_RESOLVE] = resolve;
                // this[RENDEREND_REJECT] = reject;
            });
        }

        get finish() {
            return this[RENDEREND];
        }
    }

    defaults.proto && extend(CustomXhearEle.prototype, defaults.proto);

    // 注册组件的地址
    let scriptSrc = document.currentScript && document.currentScript.src;

    // 注册自定义元素
    const XhearElement = class extends HTMLElement {
        constructor() {
            super();

            // 设置相关数据
            this.__xInfo = {
                scriptSrc
            };

            // 删除旧依赖，防止组件注册前的xhear实例缓存
            delete this.__xhear__;
            let _xhearThis = new CustomXhearEle(this);

            // 设置渲染识别属性
            Object.defineProperty(this, "xvele", {
                value: true
            });
            Object.defineProperty(_xhearThis, "xvele", {
                value: true
            });

            let xvid = this.xvid = "xv" + getRandomId();

            let options = Object.assign({}, defaults);

            // 设置x-ele
            if (this.parentElement) {
                this.setAttribute("x-ele", "");
            } else {
                nextTick(() => this.setAttribute("x-ele", ""), xvid);
            }

            renderComponent(this, options);
            options.ready && options.ready.call(_xhearThis[PROXYTHIS]);

            options.slotchange && _xhearThis.$shadow.on('slotchange', (e) => options.slotchange.call(_xhearThis[PROXYTHIS], e))

            Object.defineProperties(this, {
                [RUNARRAY]: {
                    writable: true,
                    value: 0
                }
            });
        }

        connectedCallback() {
            if (this[RUNARRAY]) {
                return;
            }
            defaults.attached && defaults.attached.call(createXhearProxy(this));
        }

        disconnectedCallback() {
            if (this[RUNARRAY]) {
                return;
            }

            let _this = createXhearProxy(this)

            defaults.detached && defaults.detached.call(_this);

            // 深度清除数据
            _this.deepClear();
        }

        attributeChangedCallback(name, oldValue, newValue) {
            let xEle = this.__xhear__;
            name = attrToProp(name);
            if (newValue != xEle[name]) {
                xEle.setData(name, newValue);
            }
        }

        static get observedAttributes() {
            return attrs.map(e => propToAttr(e));
        }
    }

    Object.assign(defaults, {
        XhearElement
    });

    // 设置映射tag数据
    regDatabase.set(defaults.tag, defaults);

    customElements.define(tag, XhearElement);
}

// 定位元素
const postionNode = (e) => {
    let textnode = document.createTextNode("");
    let par = e.parentNode;
    par.insertBefore(textnode, e);
    par.removeChild(e);

    return {
        textnode, par
    };
}

// render函数用元素查找（包含自身元素）
const getCanRenderEles = (root, expr, opts = { rmAttr: true }) => {
    let arr = queAllToArray(root, expr).map(ele => {
        return { ele };
    });

    if (root instanceof Element && createXhearEle(root).is(expr)) {
        arr.unshift({ ele: root });
    }

    // 对特殊属性进行处理
    let exData = /^\[(.+)\]$/.exec(expr);
    if (arr.length && exData) {
        let attrName = exData[1];

        arr.forEach(e => {
            let { ele } = e;

            let val = ele.getAttribute(attrName);
            if (opts.rmAttr) {
                ele.removeAttribute(attrName);
                ele.setAttribute(`rendered-${attrName}`, val);
            }
            e.attrVal = val;
        });
    }

    return arr;
}

class XDataProcessAgent {
    constructor(proxyEle) {
        // 处理用寄存对象
        this.processObj = new Map();
        this.proxyEle = proxyEle;
        this._hasAdd = false;
    }

    init() {
        if (!this._hasAdd) {
            // 没有添加就不折腾
            return;
        }

        let { processObj, proxyEle } = this;

        const canSetKey = proxyEle[CANSETKEYS];

        // 根据寄存对象监听值
        for (let [expr, d] of processObj) {
            let { calls, target } = d;
            target = target || proxyEle;

            if (canSetKey.has(expr)) {
                let watchFun;
                target.watch(expr, watchFun = (e, val) => {
                    console.log("change 1", expr);
                    calls.forEach(d => d.change(val));
                });
                nextTick(() => watchFun({}, target[expr]));

                // 清除的话事假监听
                proxyEle.on("clearxdata", e => {
                    // clearXData(target);
                    target.unwatch(expr, watchFun);
                });
            } else {
                // 其余的使用函数的方式获取
                let f = exprToFunc(expr);
                let old_val;

                let watchFun;
                // 是否首次运行
                let isFirst = 1;
                target.watch(watchFun = e => {
                    // console.time(`per_call(${expr}) ${target.xid}`);
                    let val = f.call(target);

                    if (isFirst) {
                        isFirst = 0;
                    } else if (val === old_val || (val instanceof XData && val.string === old_val)) {
                        // console.timeEnd(`per_call(${expr}) ${target.xid}`);
                        return;
                    }

                    calls.forEach(d => d.change(val));
                    // console.timeEnd(`per_call(${expr}) ${target.xid}`);

                    if (val instanceof XData) {
                        old_val = val.string;
                    } else {
                        old_val = val;
                    }
                });
                nextTick(() => watchFun({}));

                // 清除的话事假监听
                proxyEle.on("clearxdata", e => {
                    target.unwatch(watchFun);
                });

                // 同时监听index变动
                target.on("updateIndex", watchFun);
                // 监听主动触发
                target.on("reloadView", watchFun);
            }
        }
    }

    // 添加表达式监听
    add(expr, func) {
        let processObj = this.processObj;
        let calls = processObj.get(expr.trim());
        if (!calls) {
            calls = [];
            processObj.set(expr, { calls });
        } else {
            calls = calls.calls;
        }

        calls.push({
            change: func
        })

        this._hasAdd = true;
    }

    // 清除监听
    remove(expr, func) {
        let processObj = this.processObj;
        let calls = processObj.get(expr.trim());
        if (calls) {
            calls = calls.calls;
            let tarIndex = calls.findIndex(e => e.change === func);
            calls.splice(tarIndex, 1);
        }
    }
}

/**
 * 转换元素内的特殊模板语法为模板属性
 * @param {Element} sroot 需要转换模板属性的元素
 */
const transTemp = (sroot) => {
    let templateId = getRandomId();

    // 重新中转内部特殊属性
    getCanRenderEles(sroot, "*").forEach(e => {
        let { ele } = e;

        let attrbs = Array.from(ele.attributes);

        // 结束后要去除的属性
        let attrsRemoveKeys = new Set();

        // 事件绑定数据
        let bindEvent = {};

        // 属性绑定数据
        let bindAttr = {};

        attrbs.forEach(obj => {
            let {
                name, value
            } = obj;
            name = attrToProp(name);

            // 重定向目标
            if (name === "$") {
                ele.setAttribute("x-target", value);
                attrsRemoveKeys.add(name);
                return;
            }

            // 事件绑定
            let eventExecs = /^@(.+)/.exec(name);
            if (eventExecs) {
                bindEvent[eventExecs[1]] = value;
                attrsRemoveKeys.add(name);
                return;
            }

            // 属性绑定
            let attrExecs = /^:(.+)/.exec(name);
            if (attrExecs) {
                bindAttr[attrExecs[1]] = value;
                attrsRemoveKeys.add(name);
                return;
            }
        });

        let bindEventStr = JSON.stringify(bindEvent);
        if (bindEventStr != "{}") {
            ele.setAttribute("x-on", bindEventStr);
        }

        let bindAttrStr = JSON.stringify(bindAttr);
        if (bindAttrStr != "{}") {
            ele.setAttribute("x-bind", bindAttrStr);
        }

        attrsRemoveKeys.forEach(k => {
            ele.removeAttribute(propToAttr(k))
        });

        if (ele.getAttribute("x-model")) {
            ele.setAttribute("x-model-id", templateId);
        }
    });

    return { templateId };
}


// 渲染shadow dom 的内容
const renderTemp = ({ sroot, proxyEle, temps, templateId }) => {
    let xpAgent = new XDataProcessAgent(proxyEle);

    const canSetKey = proxyEle[CANSETKEYS];

    // if (!templateId) {
    //     let d = transTemp(sroot);
    //     templateId = d.templateId;
    // }

    // x-if 为了递归组件和模板，还有可以节省内存的情况
    getCanRenderEles(sroot, "[x-if]").forEach(e => {
        let { ele, attrVal } = e;

        // 定位元素
        let { textnode, par } = postionNode(ele);

        let iTempEle = e.ele;

        let targetEle;

        xpAgent.add(attrVal, val => {
            if (!val && targetEle) {
                par.removeChild(targetEle.ele);
                targetEle = null;
            } else if (val && !targetEle) {
                targetEle = createXhearProxy(parseToDom(iTempEle.innerHTML));
                par.insertBefore(targetEle.ele, textnode);
                renderTemp({ sroot, proxyEle, temps, xpAgent, templateId });
            }
        });
    });

    // x-fill 填充数组，概念上相当于数组在html中的slot元素
    // x-fill 相比 for 更能发挥 stanz 数据结构的优势；更好的理解多重嵌套的数据结构；
    let xFills = getCanRenderEles(sroot, '[x-fill]');
    if (xFills.length) {
        xFills.forEach(e => {
            let { ele, attrVal } = e;

            let matchAttr = attrVal.match(/(.+?) +use +(.+)/)

            if (!matchAttr) {
                console.error({
                    expr: attrVal,
                    desc: "fill expression error",
                });
                return;
            }

            // attrName 引用填充的属性名
            // contentName 填充的内容，带 - 名的为自定义组件，其他为填充模板
            let [, attrName, contentName] = matchAttr;

            renderFakeFill({
                ele,
                attrName,
                useTempName: contentName,
                host: proxyEle,
                temps
            });
        });
    }

    // x-target
    getCanRenderEles(sroot, "[x-target]").forEach(e => {
        let { ele, attrVal } = e;

        Object.defineProperty(proxyEle, "$" + attrVal, {
            get: () => createXhearProxy(ele)
        });
    });

    // x-show
    getCanRenderEles(sroot, "[x-show]").forEach(e => {
        let { ele, attrVal } = e;

        xpAgent.add(attrVal, val => {
            if (val) {
                ele.style.display = "";
            } else {
                ele.style.display = "none";
            }
        });
    });

    // 文本渲染
    getCanRenderEles(sroot, "x-span").forEach(e => {
        let { ele } = e;

        // 定位元素
        let { textnode, par } = postionNode(ele);

        let expr = ele.getAttribute('xvkey');

        xpAgent.add(expr, val => {
            if (val instanceof XData) {
                val = val.string;
            } else {
                val = String(val);
            }
            textnode.textContent = val;
        });
    });

    // 事件修正
    getCanRenderEles(sroot, `[x-on]`).forEach(e => {
        let { ele, attrVal } = e;

        let data = JSON.parse(attrVal);

        let $ele = createXhearEle(ele);

        Object.keys(data).forEach(eventStr => {
            let [eventName, ...opts] = eventStr.split('.');

            let prop = data[eventStr];

            let func;
            if (isFunctionExpr(prop)) {
                func = exprToFunc(prop);
            } else {
                func = proxyEle[prop];
            }

            let functionName = "on";
            if (opts.includes("once")) {
                functionName = "one";
            }

            let isFunc = isFunction(func);
            if (!isFunc) {
                console.warn({
                    target: sroot,
                    eventName,
                    desc: "no binding functions"
                });
            }

            $ele[functionName](eventName, (event, data) => {
                if (opts.includes("prevent")) {
                    event.preventDefault();
                }

                if (opts.includes("stop")) {
                    event.bubble = false;
                }

                isFunc && func.call(proxyEle, event, data);
            });
        });
    });

    // 属性修正
    getCanRenderEles(sroot, `[x-bind]`).forEach(e => {
        let { ele, attrVal } = e;

        let data = JSON.parse(attrVal);

        Object.keys(data).forEach(attrName => {
            let expr = data[attrName];

            let isEachBinding = /^#(.+)/.exec(attrName);
            if (isEachBinding) {
                attrName = isEachBinding[1];
                isEachBinding = !!isEachBinding;

                // 函数表达式不能用于双向绑定
                if (isFunctionExpr(expr)) {
                    throw {
                        desc: "Function expressions cannot be used for sync binding",
                    };
                } else if (!canSetKey.has(expr) && !/^\$data\./.test(expr) && expr !== "$data") {
                    // 不能双向绑定的值
                    console.error({
                        desc: "the key can't sync bind",
                        key: "attrName",
                        target: ele,
                        host: proxyEle
                    });
                }

                // 数据反向绑定
                createXhearEle(ele).watch(attrName, (e, val) => {
                    proxyEle.setData(expr, val);
                });
            }

            xpAgent.add(expr, val => {
                if (val instanceof XhearEle) {
                    val = val.object;
                }

                if (ele.xvele) {
                    createXhearEle(ele).setData(attrName, val);
                } else {
                    attrName = propToAttr(attrName);
                    if (val === undefined || val === null) {
                        ele.removeAttribute(attrName);
                    } else {
                        ele.setAttribute(attrName, val);
                    }
                }
            });
        });
    });


    // 需要跳过的元素列表
    let xvModelJump = new Set();

    // 绑定 x-model
    getCanRenderEles(sroot, `[x-model]`).forEach(e => {
        let { ele, attrVal } = e;

        if (xvModelJump.has(ele)) {
            // checkbox已经添加过一次了
            return;
        }

        let modelKey = attrVal;

        switch (ele.tagName.toLowerCase()) {
            case "input":
                let inputType = ele.getAttribute("type");
                switch (inputType) {
                    case "checkbox":
                        // 判断是不是复数形式的元素
                        let allChecks = getCanRenderEles(sroot, `input[type="checkbox"][rendered-x-model="${modelKey}"][x-model-id="${templateId}"]`);

                        // 查看是单个数量还是多个数量
                        if (allChecks.length > 1) {
                            allChecks.forEach(e => {
                                let checkbox = e.ele;
                                checkbox.addEventListener('change', e => {
                                    let { value, checked } = e.target;

                                    let tarData = proxyEle.getData(modelKey);
                                    if (checked) {
                                        tarData.add(value);
                                    } else {
                                        tarData.delete(value);
                                    }
                                });
                            });

                            // 添加到跳过列表里
                            allChecks.forEach(e => {
                                xvModelJump.add(e);
                            })
                        } else {
                            // 单个直接绑定checked值
                            proxyEle.watch(modelKey, (e, val) => {
                                ele.checked = val;
                            }, true);
                            ele.addEventListener("change", e => {
                                let { checked } = ele;
                                proxyEle.setData(modelKey, checked);
                            });
                        }
                        return;
                    case "radio":
                        let allRadios = getCanRenderEles(sroot, `input[type="radio"][rendered-x-model="${modelKey}"][x-model-id="${templateId}"]`);

                        let rid = getRandomId();

                        allRadios.forEach(e => {
                            let radioEle = e.ele;
                            radioEle.setAttribute("name", `radio_${modelKey}_${rid}`);
                            radioEle.addEventListener("change", e => {
                                if (radioEle.checked) {
                                    proxyEle.setData(modelKey, radioEle.value);
                                }
                            });
                        });
                        return;
                }
            // 其他input 类型继续往下走
            case "textarea":
            case "text":
                proxyEle.watch(modelKey, (e, val) => {
                    ele.value = val;
                });
                nextTick(() => ele.value = proxyEle[modelKey]);
                ele.addEventListener("input", e => {
                    proxyEle.setData(modelKey, ele.value);
                });
                break;
            case "select":
                proxyEle.watch(modelKey, (e, val) => {
                    ele.value = val;
                });
                nextTick(() => ele.value = proxyEle[modelKey]);
                ele.addEventListener("change", e => {
                    proxyEle.setData(modelKey, ele.value);
                });
                break;
            default:
                // 自定义组件
                if (ele.xvele) {
                    let cEle = ele.__xhear__;
                    cEle.watch("value", (e, val) => {
                        proxyEle.setData(modelKey, val);
                    });
                    proxyEle.watch(modelKey, (e, val) => {
                        cEle.setData("value", val);
                    }, true);
                } else {
                    console.warn(`can't x-model with thie element => `, ele);
                }
        }
    });
    xvModelJump.clear();
    xvModelJump = null;

    xpAgent.init();
}

// 将x-if元素嵌套template
const warpXifTemp = (html) => {
    let f_temp = document.createElement("template");

    f_temp.innerHTML = html;

    let ifEles = Array.from(f_temp.content.querySelectorAll("[x-if]"));

    // if元素添加 template 包裹
    ifEles.forEach(e => {
        if (e.tagName.toLowerCase() == "template") {
            return;
        }

        let ifTempEle = document.createElement("template");
        ifTempEle.setAttribute("x-if", e.getAttribute("x-if"));
        e.removeAttribute("x-if");

        // 替换位置
        e.parentNode.insertBefore(ifTempEle, e);
        ifTempEle.content.appendChild(e);
    });

    // template 内的 x-if 也要转换
    Array.from(f_temp.content.querySelectorAll("template")).forEach(temp => {
        let { html } = warpXifTemp(temp.innerHTML)
        temp.innerHTML = html;
    });

    let { templateId } = transTemp(f_temp.content);

    // 填充默认内容
    return {
        templateId,
        html: f_temp.innerHTML
    };
}

// 渲染组件元素
const renderComponent = (ele, defaults) => {
    // 初始化元素
    let xhearEle = createXhearEle(ele);

    // 存储promise队列
    let renderTasks = [];

    // 合并 proto
    defaults.proto && extend(xhearEle, defaults.proto);

    let { temp } = defaults;
    let sroot;

    // 要设置的数据
    let rData = Object.assign({}, defaults.data);

    // 添加_exkey
    let canSetKey = Object.keys(rData);
    canSetKey.push(...defaults.attrs);
    canSetKey.push(...Object.keys(defaults.watch));
    canSetKey = new Set(canSetKey);
    canSetKey.forEach(k => {
        // 去除私有属性
        if (/^_.+/.test(k)) {
            canSetKey.delete(k);
        }
    });
    let ck = xhearEle[CANSETKEYS];
    if (!ck) {
        Object.defineProperty(xhearEle, CANSETKEYS, {
            value: canSetKey
        });
    } else {
        canSetKey.forEach(k => ck.add(k))
    }

    // 判断是否有value，进行vaule绑定
    if (canSetKey.has("value")) {
        Object.defineProperty(ele, "value", {
            get() {
                return xhearEle.value;
            },
            set(val) {
                xhearEle.value = val;
            }
        });
    }

    // watch事件绑定
    xhearEle.watch(defaults.watch);

    // attrs 上的数据
    defaults.attrs.forEach(attrName => {
        // 绑定值
        xhearEle.watch(attrName, d => {
            if (d.val === null || d.val === undefined) {
                ele.removeAttribute(propToAttr(attrName));
            } else {
                // 绑定值
                ele.setAttribute(propToAttr(attrName), d.val);
            }
        });
    });

    Object.keys(rData).forEach(k => {
        let val = rData[k];

        if (!isUndefined(val)) {
            // xhearEle[k] = val;
            xhearEle.setData(k, val);
        }
    });

    if (temp) {
        // 添加shadow root
        sroot = ele.attachShadow({ mode: "open" });

        // 去除无用的代码（注释代码）
        temp = temp.replace(/<!--.+?-->/g, "");

        // 自定义字符串转换
        var textDataArr = temp.match(/{{.+?}}/g);
        textDataArr && textDataArr.forEach((e) => {
            var key = /{{(.+?)}}/.exec(e);
            if (key) {
                temp = temp.replace(e, `<x-span xvkey="${key[1].trim()}"></x-span>`);
            }
        });

        // 填充默认内容
        let { html, templateId } = warpXifTemp(temp);
        sroot.innerHTML = html;

        // 查找所有模板
        let temps = new Map();
        let tempEle = Array.from(sroot.querySelectorAll(`template[name]`));
        tempEle.length && tempEle.forEach(e => {
            // 内部清除
            e.parentNode.removeChild(e);

            // 注册元素
            let name = e.getAttribute("name");

            temps.set(name, e);
        });

        renderTemp({
            sroot,
            proxyEle: xhearEle[PROXYTHIS],
            temps, templateId
        });
    }

    // 查找是否有link为完成
    if (sroot) {
        let links = queAllToArray(sroot, `link`);
        if (links.length) {
            links.forEach(link => {
                renderTasks.push(new Promise((resolve, reject) => {
                    if (link.sheet) {
                        resolve();
                    } else {
                        link.addEventListener("load", e => {
                            resolve();
                        });
                        link.addEventListener("error", e => {
                            reject({
                                desc: "link load error",
                                error: e,
                                target: ele
                            });
                        });
                    }
                }));
            });
        }
    }

    // 设置渲染完毕
    let setRenderend = () => {
        nextTick(() => ele.setAttribute("x-ele", 1), ele.xvid);
        xhearEle[RENDEREND_RESOLVE]();
        xhearEle.trigger('renderend', {
            bubbles: false
        });
        setRenderend = null;
    }

    if (renderTasks.length) {
        Promise.all(renderTasks).then(() => {
            setRenderend();
        });
    } else {
        setRenderend();
    }
}