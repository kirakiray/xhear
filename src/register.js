// 注册数据
const regDatabase = new Map();

const RUNARRAY = Symbol("runArray");

// 渲染结束标记
const RENDEREND = Symbol("renderend"), RENDEREND_RESOLVE = Symbol("renderend_resove"), RENDEREND_REJECT = Symbol("renderend_reject");

const ATTRBINDINGKEY = "attr" + getRandomId();

// 是否表达式
const isFunctionExpr = (str) => /[ \|\&\(\)\?\:\!;]/.test(str.trim());

// 获取函数
const exprToFunc = (expr) => {
    return new Function("$event", `
with(this){
    try{
        return ${expr}
    }catch(e){
        let errObj = {
            expr:'${expr.replace(/'/g, "\\'").replace(/"/g, '\\"')}',
        }
        ele.__xInfo && Object.assign(errObj,ele.__xInfo);
        console.error(errObj,e);
    }
}
    `);
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

    defaults.proto && CustomXhearEle.prototype.extend(defaults.proto);

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

            // 设置xv-ele
            if (this.parentElement) {
                this.setAttribute("xv-ele", "");
            } else {
                nextTick(() => this.setAttribute("xv-ele", ""), xvid);
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
const getCanRenderComponents = (root, expr) => {
    let arr = queAllToArray(root, expr);
    if (!(root instanceof DocumentFragment) && createXhearEle(root).is(expr)) {
        arr.unshift(root);
    }
    return arr;
}

// 渲染shadow dom 的内容
const renderTemp = ({ sroot, proxyEle, temps }) => {
    // 处理用寄存对象
    const processObj = new Map();
    const addProcess = (expr, func) => {
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
    }

    const canSetKey = proxyEle[CANSETKEYS];

    // 重新中转内部特殊属性
    getCanRenderComponents(sroot, "*").forEach(ele => {
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
                Object.defineProperty(proxyEle, "$" + value, {
                    get: () => createXhearProxy(ele)
                });
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
            ele.setAttribute("xv-on", bindEventStr);
        }

        let bindAttrStr = JSON.stringify(bindAttr);
        if (bindAttrStr != "{}") {
            ele.setAttribute("xv-bind", bindAttrStr);
        }

        attrsRemoveKeys.forEach(k => {
            ele.removeAttribute(k)
        });
    });

    // xv-fill 填充数组，概念上相当于数组在html中的slot元素
    // xv-fill 相比 for 更能发挥 stanz 数据结构的优势；更好的理解多重嵌套的数据结构；
    let xvFills = getCanRenderComponents(sroot, '[xv-fill]');
    if (xvFills.length) {
        let xvFillObj = {};
        Object.defineProperty(proxyEle, "$fillElements", {
            get: () => xvFillObj
        })

        xvFills.forEach(ele => {
            let contentName = ele.getAttribute("fill-content");
            let attrName = ele.getAttribute('xv-fill');

            // 设置fill元素
            let targetFillEle = xvFillObj[contentName] = createXhearProxy(ele);
            ele.__fill_target = {
                upperFill: proxyEle
            };

            addProcess(attrName, (val, trends) => {
                trends.forEach(trend => {
                    if (trend.name == "setData" && trend.keys.length == 0 && trend.args[0] == attrName) {
                        targetFillEle.html = "";

                        // 重新设置值
                        val.forEach(e => {
                            let fillChildComp;

                            if (/^[a-z]+\-[a-z]+$/.test(contentName)) {
                                // 组件绑定
                                fillChildComp = $({
                                    tag: contentName
                                });
                            } else {
                                // 模板绑定
                                fillChildComp = createTemplateElement({
                                    name: contentName,
                                    temps,
                                    parentProxyEle: proxyEle,
                                    targetData: e
                                });
                            }

                            // 组件初次数据设定
                            Object.assign(fillChildComp, e.object);

                            targetFillEle.ele.appendChild(fillChildComp.ele);
                        });
                        return;
                    }

                    // 数据层同步到元素层
                    let t2 = JSON.parse(JSON.stringify(trend));
                    t2.keys.shift();
                    targetFillEle.entrend(t2);
                });
            });

            // 元素层同步到数据层
            targetFillEle.watch((e) => {
                e.trends.forEach(trend => {
                    proxyEle[attrName].entrend(trend);
                });
            })
        });

        Object.freeze(xvFillObj);
    }

    // xv-if判断
    // if会重新渲染组件，滥用导致性能差， 5.2之后不允许使用if，请改用xv-show
    // queAllToArray(sroot, "[xv-if]").forEach(e => {
    //     debugger
    // });

    // xv-show
    getCanRenderComponents(sroot, "[xv-show]").forEach(e => {
        addProcess(e.getAttribute("xv-show"), val => {
            if (val) {
                e.style.display = "";
            } else {
                e.style.display = "none";
            }
        });
    });

    // 文本渲染
    getCanRenderComponents(sroot, "xv-span").forEach(e => {
        // 定位元素
        let { textnode, par } = postionNode(e);

        let expr = e.getAttribute('xvkey');

        addProcess(expr, val => {
            textnode.textContent = val;
        });
    });

    // 事件修正
    getCanRenderComponents(sroot, `[xv-on]`).forEach(e => {
        let data = JSON.parse(e.getAttribute("xv-on"));

        let $ele = createXhearEle(e);

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

            $ele[functionName](eventName, (event, data) => {
                if (opts.includes("prevent")) {
                    event.preventDefault();
                }

                if (opts.includes("stop")) {
                    event.bubble = false;
                }

                func.call(proxyEle, event, data);
            });
        });
    });

    // 属性修正
    getCanRenderComponents(sroot, `[xv-bind]`).forEach(ele => {
        let data = JSON.parse(ele.getAttribute("xv-bind"));

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
                } else if (!canSetKey.has(expr)) {
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

            addProcess(expr, val => {
                if (val instanceof XhearEle) {
                    val = val.object;
                }

                if (ele.xvele) {
                    createXhearEle(ele).setData(attrName, val);
                } else {
                    ele.setAttribute(attrName, val);
                }
            });
        });
    });


    // 需要跳过的元素列表
    let xvModelJump = new Set();

    // 绑定 xv-model
    getCanRenderComponents(sroot, `[xv-model]`).forEach(ele => {
        if (xvModelJump.has(ele)) {
            return;
        }

        let modelKey = ele.getAttribute("xv-model");

        switch (ele.tagName.toLowerCase()) {
            case "input":
                let inputType = ele.getAttribute("type");
                switch (inputType) {
                    case "checkbox":
                        // 判断是不是复数形式的元素
                        let allChecks = getCanRenderComponents(sroot, `input[type="checkbox"][xv-model="${modelKey}"]`);

                        // 查看是单个数量还是多个数量
                        if (allChecks.length > 1) {
                            allChecks.forEach(checkbox => {
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
                            });
                            ele.addEventListener("change", e => {
                                let { checked } = ele;
                                proxyEle.setData(modelKey, checked);
                            });
                        }
                        return;
                    case "radio":
                        let allRadios = getCanRenderComponents(sroot, `input[type="radio"][xv-model="${modelKey}"]`);

                        let rid = getRandomId();

                        allRadios.forEach(radioEle => {
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
                proxyEle.watch(modelKey, (e, val) => {
                    ele.value = val;
                });
                ele.addEventListener("input", e => {
                    proxyEle.setData(modelKey, ele.value);
                });
                break;
            case "select":
                proxyEle.watch(modelKey, (e, val) => {
                    ele.value = val;
                });
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
                    });
                } else {
                    console.warn(`can't xv-model with thie element => `, ele);
                }
        }
    });
    xvModelJump.clear();
    xvModelJump = null;

    // 根据寄存对象监听值
    for (let [expr, d] of processObj) {
        let { calls, target } = d;
        target = target || proxyEle;

        if (canSetKey.has(expr)) {
            target.watch(expr, (e, val) => {
                calls.forEach(d => d.change(val, e.trends));
            });
        } else {
            // 其余的使用函数的方式获取
            let f = exprToFunc(expr);
            let old_val;

            let watchFun;
            target.watch(watchFun = e => {
                let val = f.call(target);

                if (val === old_val || (val instanceof XData && val.string === old_val)) {
                    return;
                }

                let trends = e ? e.trends : undefined;
                calls.forEach(d => d.change(val, trends));

                if (val instanceof XData) {
                    old_val = val.string;
                } else {
                    old_val = val;
                }
            });

            // 同时监听index变动
            target.on("updateIndex", watchFun);
            // 监听主动触发
            target.on("reloadView", watchFun);
        }
    }
}

// 渲染组件内的模板元素
const createTemplateElement = ({
    // 模板名
    name,
    // 所有的模板数据
    temps,
    // 顶层依附对象
    parentProxyEle,
    // 循环上需要的对象
    targetData
}) => {
    let template = temps.get(name);

    if (!template) {
        throw {
            desc: "find out the template",
            name,
            targetElement: parentProxyEle.ele
        };
    }

    // 判断 template 内只能存在一个元素
    if (template.content.children.length > 1) {
        console.error({
            desc: "only one child element will be rendered",
            target: template,
            targetElement: parentProxyEle.ele
        });
    }

    // 重造元素
    let n_ele = template.content.children[0].cloneNode(true);
    let n_proxyEle = createXhearProxy(n_ele);
    let n_xhearEle = createXhearEle(n_ele);
    n_proxyEle[CANSETKEYS] = new Set([...Object.keys(targetData)]);

    // 绑定数据
    Object.defineProperty(n_xhearEle, "$data", {
        get: () => {
            return targetData;
        }
    });

    // 绑定事件
    let regData = regDatabase.get(parentProxyEle.tag);
    Object.keys(regData.proto).forEach(funcName => {
        let func = regData.proto[funcName];
        if (isFunction(func)) {
            Object.defineProperty(n_xhearEle, funcName, {
                value: func.bind(parentProxyEle)
            });
        }
    });

    // 重定向拥有的function
    // let oldGetData = n_xhearEle.getData;
    // n_xhearEle.getData = function (key) {
    //     // 获取自身的值
    //     let val = oldGetData.call(this, key);

    //     // 不存在的话就是主体函数的东西
    //     if (val === undefined) {
    //         if (key == "toJSON") {
    //             return;
    //         }
    //         debugger
    //         console.log("args => ", args);
    //     }

    //     return val;
    // };

    renderTemp({
        sroot: n_ele,
        proxyEle: n_proxyEle,
        temps
    });

    return n_proxyEle;
}

// 渲染组件元素
const renderComponent = (ele, defaults) => {
    // 初始化元素
    let xhearEle = createXhearEle(ele);

    // 存储promise队列
    let renderTasks = [];

    // 合并 proto
    defaults.proto && xhearEle.extend(defaults.proto);

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
                temp = temp.replace(e, `<xv-span xvkey="${key[1].trim()}"></xv-span>`);
            }
        });

        // 填充默认内容
        sroot.innerHTML = temp;

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
            temps
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

    // 合并数据后设置
    Object.keys(rData).forEach(k => {
        let val = rData[k];

        if (!isUndefined(val)) {
            // xhearEle[k] = val;
            xhearEle.setData(k, val);
        }
    });

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
        nextTick(() => ele.setAttribute("xv-ele", 1), ele.xvid);
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