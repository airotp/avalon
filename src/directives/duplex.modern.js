//双工绑定
var builtin = require("../base/builtin")
var W3C = builtin.W3C
var document = builtin.document
var msie = builtin.msie
var markID = builtin.markID
var pushArray = builtin.pushArray
var getBindingValue = require("./var/getBindingValue")
var createVirtual = require("../strategy/createVirtual")

var hooks = require("../vdom/hooks")
var addData = hooks.addData
var addAttrHook = hooks.addAttrHook

var addHooks = hooks.addHooks
var addHook = hooks.addHook

var rcheckedType = /^(?:checkbox|radio)$/
var rcheckedFilter = /\|\s*checked\b/
var rchangeFilter = /\|\s*change\b/

var rnoduplexInput = /^(file|button|reset|submit|checkbox|radio|range)$/
var oldName = {
    "radio": "checked",
    "number": "numeric",
    "bool": "boolean",
    "text": "string"
}
avalon.directive("duplex", {
    priority: 2000,
    init: function (binding, hasCast) {
        var elem = binding.element
        var vmodel = binding.vmodel
        var fn = getBindingValue(elem, "data-duplex-changed", vmodel)
        if (typeof fn !== "function") {
            fn = avalon.noop
        }
        binding.changed = fn
        var nodeName = elem.type.toLowerCase()
        if (nodeName === "input" && !elem.props.type) {
            elem.props.type = "text"
        }
        var elemType = elem.props.type
        var ret = []
        binding.param.replace(/\w+/g, function (name) {
            var newName = oldName[name] || name
            avalon.log("ms-duplex-" + name + "已经被废掉,改成" + newName + "过滤器")
            ret.push(newName)
        })

        binding.param = ""
        binding.expr += ret.join("|")

        if (rcheckedFilter.test(binding.expr)) {
            if (rcheckedType.test(elem.props.type)) {
                elem.props.xtype = "checked"
            } else {
                avalon.log("只有radio与checkbox才能用checked过滤器")
                binding.expr = binding.expr.replace(rcheckedFilter, "")
            }
        }
        if (rchangeFilter.test(binding.expr)) {
            if (rnoduplexInput.test(elem.Type)) {
                avalon(elemType + "不支持change过滤器")
                binding.expr = binding.expr.replace(rchangeFilter, "")
            } else {
                elem.props.xtype = "change"
            }
        }
        if (!elem.props.xtype) {
            elem.props.xtype = nodeName === "select" ? "select" :
                    elemType === "checkbox" ? "checkbox" :
                    elemType === "radio" ? "radio" :
                    /^change/.test(elem.props["data-duplex-event"]) ? "change" :
                    "input"
        }
        var duplexEvents = {}
        switch (elem.props.xtype) {
            case "checked"://当用户指定了checked过滤器
                duplexEvents.click = duplexChecked
                break
            case "radio":
                duplexEvents.click = duplexValue
                break
            case "checkbox":
                duplexEvents.change = duplexCheckBox
                break
            case "change":
                duplexEvents.change = duplexValue
                break
            case "select":
                if (!elem.children.length) {
                    pushArray(elem.children, createVirtual(elem.template))
                }
                duplexEvents.change = duplexSelect
                break
            case "input":
                if (!msie) { // W3C
                    duplexEvents.input = duplexValue
                    duplexEvents.compositionstart = compositionStart
                    duplexEvents.compositionend = compositionEnd
                    duplexEvents.DOMAutoComplete = duplexValue
                } else {

                    //IE下通过selectionchange事件监听IE9+点击input右边的X的清空行为，及粘贴，剪切，删除行为
                    //IE9删除字符后再失去焦点不会同步 #1167
                    duplexEvents.keyup = duplexValue
                    //IE9使用propertychange无法监听中文输入改动
                    duplexEvents.input = duplexValue
                    duplexEvents.dragend = duplexDragEnd
                    //http://www.cnblogs.com/rubylouvre/archive/2013/02/17/2914604.html
                    //http://www.matts411.com/post/internet-explorer-9-oninput/
                }
                break

        }

        if (elem.props.xtype === "input" && !rnoduplexInput.test(elemType)) {
            if (elemType !== "hidden") {
                duplexEvents.focus = duplexFocus
                duplexEvents.blur = duplexBlur
            }
            elem.watchValueInTimer = true
        }
        elem.duplexEvents = duplexEvents
        elem.dispose = disposeDuplex
    }
    ,
    change: function (value, binding) {
        var elem = binding.element
        if (!elem || elem.disposed)
            return

        if (elem.type === "select") {
            addHook(elem, duplexSelectAfter, "afterChange")
        }

        elem.value = value
        elem.binding = binding
        addHooks(this, binding)
    },
    update: function (node, vnode) {
        var binding = vnode.binding
        var curValue = node.vmValue = vnode.value
        vnode.dom = node //方便进行垃圾回收

        node.duplexSet = function (value) {
            binding.setter(binding.vmodel, value, node)
        }

        node.duplexGet = function (value) {
            return binding.getter(binding.vmodel, value, node)
        }

        node.changed = binding.changed

        var events = vnode.duplexEvents
        if (events) {
            for (var eventName in events) {
                avalon.bind(node, eventName, events[eventName])
            }
            delete vnode.duplexEvents
        }
        if (vnode.watchValueInTimer) {
            node.valueSet = duplexValue //#765
            watchValueInTimer(function () {
                if (!vnode.disposed) {
                    if (!node.msFocus) {
                        node.valueSet()
                    }
                } else if (!node.msRetain) {
                    return false
                }
            })
            delete vnode.watchValueInTimer
        }

        switch (vnode.props.xtype) {
            case "input":
            case "change":
                if (curValue !== node.oldValue) {
                    node.value = curValue
                }
                break
            case "checked":
            case "radio":
                curValue = vnode.props.xtype === "checked" ? !!curValue :
                        curValue + "" === node.value
                node.oldValue = curValue

                node.checked = curValue

                break
            case "checkbox":
                var array = [].concat(curValue) //强制转换为数组
                curValue = node.duplexGet(node.value)
                node.checked = array.indexOf(curValue) > -1
                break
            case "select":
                //在afterChange中处理
                break
        }
    }
})

function disposeDuplex() {
    var elem = this.dom
    if (elem) {
        elem.changed = elem.oldValue = elem.valueSet =
                elem.duplexSet = elem.duplexGet = void 0
        avalon.unbind(elem)
        this.dom = null
    }
}
function compositionStart() {
    this.composing = true
}
function compositionEnd() {
    this.composing = false
}
function duplexFocus() {
    this.msFocus = true
}
function duplexBlur() {
    this.msFocus = false
}

function duplexChecked() {
    var elem = this
    var lastValue = elem.oldValue = elem.duplexGet()
    elem.duplexSet(lastValue)
    elem.changed(lastValue)
}

function duplexValue() { //原来的updateVModel
    var elem = this, fixCaret
    var val = elem.value //防止递归调用形成死循环
    if (elem.composing || val === elem.oldValue)
        return
    if (elem.msFocus) {
        try {
            var start = elem.selectionStart
            var end = elem.selectionEnd
            if (start === end) {
                var pos = start
                fixCaret = true
            }
        } catch (e) {
        }
    }
    var lastValue = elem.duplexGet(val)
    try {
        elem.value = elem.oldValue = lastValue + ""
        if (fixCaret && !elem.readOnly) {
            elem.selectionStart = elem.selectionEnd = pos
        }
        elem.duplexSet(lastValue)
        elem.changed(lastValue)
    } catch (ex) {
        avalon.log(ex)
    }
}
function duplexValueHack(e) {
    if (e.propertyName === "value") {
        duplexValue.call(this, e)
    }
}

function duplexDragEnd(e) {
    var elem = this
    setTimeout(function () {
        duplexValue.call(elem, e)
    }, 17)
}

function duplexCheckBox() {
    var elem = this
    var method = elem.checked ? "ensure" : "remove"
    var array = elem.vmValue
    if (!Array.isArray(array)) {
        log("ms-duplex应用于checkbox上要对应一个数组")
        array = [array]
    }
    var val = elem.duplexGet(elem.value)
    avalon.Array[method](array, val)
    elem.changed(array)
}

//用于更新VM
function duplexSelect() {
    var elem = this
    var val = avalon(elem).val() //字符串或字符串数组
    if (Array.isArray(val)) {
        val = val.map(function (v) {
            return  elem.duplexGet(v)
        })
    } else {
        val = elem.duplexGet(val)
    }
    if (val + "" !== elem.oldValue) {
        try {
            elem.duplexSet(val)
        } catch (ex) {
            log(ex)
        }
    }
    elem.duplexSet(val)
    elem.changed(val)
}

function duplexSelectAfter(elem, vnode) {
    avalon(elem).val(vnode.value)
}


duplexSelectAfter.priority = 2001

markID(compositionStart)
markID(compositionEnd)
markID(duplexFocus)
markID(duplexBlur)
markID(duplexValue)
markID(duplexValueHack)
markID(duplexDragEnd)
markID(duplexCheckBox)
markID(duplexSelect)

if (msie) {
    avalon.bind(document, "selectionchange", function (e) {
        var el = document.activeElement || {}
        if (!el.msFocus && el.valueSet) {
            el.valueSet()
        }
    })
}


var TimerID, ribbon = []

avalon.tick = function (fn) {
    if (ribbon.push(fn) === 1) {
        TimerID = setInterval(ticker, 60)
    }
}

function ticker() {
    for (var n = ribbon.length - 1; n >= 0; n--) {
        var el = ribbon[n]
        if (el() === false) {
            ribbon.splice(n, 1)
        }
    }
    if (!ribbon.length) {
        clearInterval(TimerID)
    }
}

var watchValueInTimer = avalon.noop
        ;
(function () { // jshint ignore:line
    try { //#272 IE9-IE11, firefox
        var setters = {}
        var aproto = HTMLInputElement.prototype
        var bproto = HTMLTextAreaElement.prototype
        function newSetter(value) { // jshint ignore:line
            setters[this.tagName].call(this, value)

            if (!this.msFocus && this.valueSet) {
                this.valueSet()
            }
        }
        var inputProto = HTMLInputElement.prototype
        Object.getOwnPropertyNames(inputProto) //故意引发IE6-8等浏览器报错
        setters["INPUT"] = Object.getOwnPropertyDescriptor(aproto, "value").set

        Object.defineProperty(aproto, "value", {
            set: newSetter
        })
        setters["TEXTAREA"] = Object.getOwnPropertyDescriptor(bproto, "value").set
        Object.defineProperty(bproto, "value", {
            set: newSetter
        })
    } catch (e) {
        //在chrome 43中 ms-duplex终于不需要使用定时器实现双向绑定了
        // http://updates.html5rocks.com/2015/04/DOM-attributes-now-on-the-prototype
        // https://docs.google.com/document/d/1jwA8mtClwxI-QJuHT7872Z0pxpZz8PBkf2bGAbsUtqs/edit?pli=1
        watchValueInTimer = avalon.tick
    }
})()

