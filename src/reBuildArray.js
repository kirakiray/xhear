// 不影响数据原结构的方法，重新做钩子
['concat', 'every', 'filter', 'find', 'findIndex', 'forEach', 'map', 'slice', 'some', 'indexOf', 'lastIndexOf', 'includes', 'join'].forEach(methodName => {
    let arrayFnFunc = Array.prototype[methodName];
    if (arrayFnFunc) {
        Object.defineProperty(XhearEleFn, methodName, {
            value(...args) {
                return arrayFnFunc.apply(Array.from(this.ele.children).map(e => createXhearProxy(e)), args);
            }
        });
    }
});

/**
 * 触发子元素的index事件
 * @param {Object} _this 目标元素
 * @param {Array} oldArr 旧的子元素数组
 */
const emitChildsXDataIndex = (_this, oldArr) => {
    _this.forEach((e, index) => {
        let oldIndex = oldArr.findIndex(e2 => e2 === e);
        if (oldIndex !== -1 && oldIndex !== index) {
            emitXDataIndex(e, index, oldIndex);
        }
    });
}

/**
 * 模拟array splice方法
 * @param {XhearEle} t 目标对象
 * @param {Number} index splice index
 * @param {Number} howmany splice howmany
 * @param {Array} items splice push items
 */
const XhearEleProtoSplice = (t, index, howmany, items = []) => {
    let _this = t[XDATASELF];

    // 返回的数组
    let reArr = [];

    // 小于0的index转换
    if (index < 0) {
        index += _this.length;
    }

    let tarele = _this.ele;
    let { children } = tarele;

    let c_howmany = !/\D/.test(howmany) ? howmany : _this.length;

    let oldArr = _this.map(e => e);

    while (c_howmany > 0) {
        let childEle = children[index];

        if (!childEle) {
            break;
        }

        reArr.push(createXhearProxy(childEle));

        // 删除目标元素
        tarele.removeChild(childEle);

        // 数量减少
        c_howmany--;
    }

    // 定位目标子元素
    let tar = children[index];

    // 添加元素
    if (items.length) {
        let fragment = document.createDocumentFragment();
        items.forEach(e => fragment.appendChild(parseToDom(e)));
        if (index >= 0 && tar) {
            tarele.insertBefore(fragment, tar)
        } else {
            tarele.appendChild(fragment);
        }
    }

    // 触发index改动
    emitChildsXDataIndex(_this, oldArr);

    emitUpdate(_this, "splice", [index, howmany, ...items]);

    return reArr;
}

/**
 * 根据数组结构进行排序
 * @param {XhearEle} t 目标对象
 * @param {Array} arr 排序数组结构
 */
const sortByArray = (t, arr) => {
    let _this = t[XDATASELF];
    let { ele } = _this;

    let childsBackup = Array.from(ele.children);
    let fragment = document.createDocumentFragment();
    arr.forEach(k => {
        let ele = childsBackup[k];
        if (ele.xvele) {
            ele[RUNARRAY] = 1;
        }
        fragment.appendChild(ele);
    });
    ele.appendChild(fragment);
    childsBackup.forEach(ele => ele.xvele && (ele[RUNARRAY] = 0));
}

// 重置所有数组方法
extend(XhearEleFn, {
    push(...items) {
        XhearEleProtoSplice(this, this.length, 0, items);
        return this.length;
    },
    splice(index, howmany, ...items) {
        return XhearEleProtoSplice(this, index, howmany, items);
    },
    unshift(...items) {
        XhearEleProtoSplice(this, 0, 0, items);
        return this.length;
    },
    shift() {
        return XhearEleProtoSplice(this, 0, 1);
    },
    pop() {
        return XhearEleProtoSplice(this, this.length - 1, 1);
    },
    reverse() {
        let oldArr = this.map(e => e);
        let childs = Array.from(this.ele.children);
        let len = childs.length;
        sortByArray(this, childs.map((e, i) => len - 1 - i));

        // 触发index改动
        emitChildsXDataIndex(this, oldArr);
        emitUpdate(this[XDATASELF], "reverse", []);
    },
    sort(arg) {
        let oldArr = this.map(e => e);

        if (isFunction(arg)) {
            // 新生成数组
            let fake_this = Array.from(this.ele.children).map(e => createXhearProxy(e));
            let backup_fake_this = Array.from(fake_this);

            // 执行排序函数
            fake_this.sort(arg);

            // 记录顺序
            arg = [];
            let putId = getRandomId();

            fake_this.forEach(e => {
                let id = backup_fake_this.indexOf(e);
                // 防止查到重复值，所以查到过的就清空覆盖
                backup_fake_this[id] = putId;
                arg.push(id);
            });
        }

        if (arg instanceof Array) {
            // 修正新顺序
            sortByArray(this, arg);
        }

        // 触发index改动
        emitChildsXDataIndex(this, oldArr);

        emitUpdate(this[XDATASELF], "sort", [arg]);
    }
});