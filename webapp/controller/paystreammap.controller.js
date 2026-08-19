sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter"
], (Controller, JSONModel, MessageToast, MessageBox, Filter, FilterOperator, Sorter) => {
    "use strict";

    const KEY_FIELDS = ["ServiceProvider", "Zahlart1", "Ktart", "Ldgrp", "Shkzg", "Dauerb"];
    const NON_KEY_FIELDS = ["DiffPost", "Koart", "Saknr", "Mwskz", "Kostl", "WbsElement", "Blart", "Text"];
    const ALL_FIELDS = [...KEY_FIELDS, ...NON_KEY_FIELDS];
    const FILTER_FIELDS = [...KEY_FIELDS, ...NON_KEY_FIELDS];

    return Controller.extend("rtl.paystreammap.paystreammap.controller.paystreammap", {
        onInit() {
            const oFieldFilters = {};
            FILTER_FIELDS.forEach(f => { oFieldFilters[f] = ""; });

            const oSingleEdit = {};
            ALL_FIELDS.forEach(f => { oSingleEdit[f] = ""; });

            this.getView().setModel(new JSONModel({
                editMode: "",
                activityMode: "",
                hasPendingChanges: false,
                fieldFilters: oFieldFilters,
                sortState: { key: "", desc: false },
                singleEditMode: "display",
                singleEdit: oSingleEdit
            }), "ui");

            this._aCreatedContexts = [];
        },

        onSelectionChange() {
            this._setPendingState();
        },

        onRowEditPress(oEvent) {
            const oUiModel = this.getView().getModel("ui");
            if (oUiModel.getProperty("/activityMode") !== "") {
                MessageToast.show(this._getText("singleEditBlockedHint"));
                return;
            }
            const oContext = oEvent.getSource().getBindingContext();
            if (!oContext) { return; }

            this._oSingleEditContext = oContext;
            const oSingleEdit = {};
            ALL_FIELDS.forEach(f => { oSingleEdit[f] = oContext.getProperty(f) || ""; });
            oUiModel.setProperty("/singleEdit", oSingleEdit);
            oUiModel.setProperty("/singleEditMode", "display");
            this.byId("navContainer").to(this.byId("singleEditPage"));
        },

        onMultiEditPress() {
            const oUiModel = this.getView().getModel("ui");
            oUiModel.setProperty("/editMode", "multi");
            oUiModel.setProperty("/activityMode", "multi");
            MessageToast.show(this._getText("multiEditActive"));
        },

        onCreatePress() {
            const oUiModel = this.getView().getModel("ui");
            if (oUiModel.getProperty("/activityMode") === "multi") { return; }

            const oInitial = {};
            ALL_FIELDS.forEach(f => { oInitial[f] = ""; });

            const oListBinding = this.byId("mapTable").getBinding("items");
            const oCreatedContext = oListBinding.create(oInitial, true, false, true);
            this._aCreatedContexts.push(oCreatedContext);
            oUiModel.setProperty("/activityMode", "create");
            this._setPendingState();
        },

        onSingleEditFieldLiveChange() {
            // no-op, save is always enabled in edit mode
        },

        onSingleEditBackPress() {
            const oUiModel = this.getView().getModel("ui");
            if (oUiModel.getProperty("/singleEditMode") === "edit") {
                if (this._oSingleEditContext) {
                    const oSingleEdit = {};
                    ALL_FIELDS.forEach(f => { oSingleEdit[f] = this._oSingleEditContext.getProperty(f) || ""; });
                    oUiModel.setProperty("/singleEdit", oSingleEdit);
                }
                oUiModel.setProperty("/singleEditMode", "display");
                return;
            }
            this.byId("navContainer").back();
        },

        onSingleEditEditPress() {
            this.getView().getModel("ui").setProperty("/singleEditMode", "edit");
        },

        async onSingleEditSavePress() {
            if (!this._oSingleEditContext) { return; }

            NON_KEY_FIELDS.forEach(f => {
                const sVal = (this.getView().getModel("ui").getProperty(`/singleEdit/${f}`) || "").trim();
                this._oSingleEditContext.setProperty(f, sVal);
            });

            try {
                await this.getView().getModel().submitBatch("paystreamBatch");
                await this._activateDrafts();
                this._setPendingState();
                this.getView().getModel("ui").setProperty("/singleEditMode", "display");
                this.byId("navContainer").back();
                MessageToast.show(this._getText("saveSuccess"));
            } catch (oError) {
                MessageBox.error(this._extractErrorMessage(oError));
            }
        },

        onDeletePress() {
            const aContexts = this.byId("mapTable").getSelectedContexts(true);
            if (!aContexts.length) {
                MessageToast.show(this._getText("deleteSelectionHint"));
                return;
            }

            const aTransient = aContexts.filter(oCtx => oCtx.isTransient());
            const aDraft = aContexts.filter(oCtx => !oCtx.isTransient() && oCtx.getProperty("IsActiveEntity") === false);
            const aActive = aContexts.filter(oCtx => !oCtx.isTransient() && oCtx.getProperty("IsActiveEntity") !== false);

            if (!aActive.length) {
                aTransient.forEach(oCtx => oCtx.delete());
                if (aDraft.length) { this._discardDrafts(aDraft); } else { this._setPendingState(); }
                return;
            }

            MessageBox.confirm(this._getText("deleteConfirm", [aContexts.length]), {
                actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                emphasizedAction: MessageBox.Action.OK,
                onClose: async (sAction) => {
                    if (sAction !== MessageBox.Action.OK) { return; }
                    try {
                        aTransient.forEach(oCtx => oCtx.delete());
                        if (aDraft.length) { await this._discardDrafts(aDraft); }
                        await Promise.all(aActive.map(oCtx => oCtx.delete("$auto")));
                        await this.getView().getModel().submitBatch("$auto");
                        MessageToast.show(this._getText("deleteSuccess"));
                        this.byId("mapTable").removeSelections(true);
                        this._setPendingState();
                        this.onRefreshPress();
                    } catch (oError) {
                        MessageBox.error(this._extractErrorMessage(oError));
                    }
                }
            });
        },

        async _discardDrafts(aContexts) {
            const oModel = this.getView().getModel();
            await Promise.all(aContexts.map(oCtx => {
                const oOperation = oModel.bindContext(
                    "com.sap.gateway.srvd.zui_rrpaystreammap_o4.v0001.Discard(...)",
                    oCtx,
                    { $$groupId: "$auto" }
                );
                return oOperation.execute("$auto");
            }));
            this._setPendingState();
            this.onRefreshPress();
        },

        async onSavePress() {
            try {
                const oModel = this.getView().getModel();
                await oModel.submitBatch("paystreamBatch");
                await this._activateDrafts();
                const oUiModel = this.getView().getModel("ui");
                oUiModel.setProperty("/editMode", "");
                oUiModel.setProperty("/activityMode", "");
                this._setPendingState();
                MessageToast.show(this._getText("saveSuccess"));
            } catch (oError) {
                MessageBox.error(this._extractErrorMessage(oError));
            }
        },

        onCancelEditPress() {
            const oModel = this.getView().getModel();
            // Transiente Kontexte (neu angelegte Zeilen) explizit löschen
            (this._aCreatedContexts || []).forEach(oCtx => {
                if (oCtx && oCtx.isTransient()) { oCtx.delete(); }
            });
            oModel.resetChanges("paystreamBatch");
            const oUiModel = this.getView().getModel("ui");
            oUiModel.setProperty("/editMode", "");
            oUiModel.setProperty("/activityMode", "");
            this.byId("mapTable").removeSelections(true);
            this._aCreatedContexts = [];
            this._setPendingState();
            this.onRefreshPress();
            MessageToast.show(this._getText("cancelSuccess"));
        },

        onRefreshPress() {
            const oBinding = this.byId("mapTable").getBinding("items");
            if (oBinding) { oBinding.refresh(); }
            this._setPendingState();
        },

        onColumnFilterLiveChange(oEvent) {
            const sField = oEvent.getSource().data("field");
            if (!sField) { return; }
            const sValue = (oEvent.getParameter("value") || "").trim();
            this.getView().getModel("ui").setProperty(`/fieldFilters/${sField}`, sValue);
            this._applyTableQueryOptions();
        },

        onColumnSortPress(oEvent) {
            const sField = oEvent.getSource().data("field");
            if (!sField) { return; }
            const oUiModel = this.getView().getModel("ui");
            const sCurrentKey = oUiModel.getProperty("/sortState/key");
            const bCurrentDesc = !!oUiModel.getProperty("/sortState/desc");
            if (sCurrentKey === sField) {
                oUiModel.setProperty("/sortState/desc", !bCurrentDesc);
            } else {
                oUiModel.setProperty("/sortState/key", sField);
                oUiModel.setProperty("/sortState/desc", false);
            }
            this._applyTableQueryOptions();
        },

        _applyTableQueryOptions() {
            const oTable = this.byId("mapTable");
            const oBinding = oTable && oTable.getBinding("items");
            if (!oBinding) { return; }

            const oUiModel = this.getView().getModel("ui");
            const oFieldFilters = oUiModel.getProperty("/fieldFilters") || {};
            const aFilters = [];

            FILTER_FIELDS.forEach(sField => {
                const sValue = (oFieldFilters[sField] || "").trim();
                if (sValue) {
                    aFilters.push(new Filter(sField, FilterOperator.Contains, sValue));
                }
            });

            oBinding.filter(aFilters, "Application");

            const sSortKey = oUiModel.getProperty("/sortState/key");
            const bSortDesc = !!oUiModel.getProperty("/sortState/desc");
            if (sSortKey) {
                oBinding.sort(new Sorter(sSortKey, bSortDesc));
            } else {
                oBinding.sort([]);
            }
        },

        async onDownloadExcelPress() {
            const oTable = this.byId("mapTable");
            const oBinding = oTable && oTable.getBinding("items");
            if (!oBinding) { return; }

            try {
                const aContexts = await oBinding.requestContexts(0, 10000);
                const aRows = aContexts.map(oCtx => oCtx.getObject());
                if (!aRows.length) {
                    MessageToast.show(this._getText("deleteSelectionHint"));
                    return;
                }

                const aColumns = ALL_FIELDS.map(k => ({ key: k, label: this._getText(k.charAt(0).toLowerCase() + k.slice(1)) }));

                const fnEsc = v => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
                const fnRow = vals => `<Row>${vals.map(v => `<Cell><Data ss:Type="String">${fnEsc(v)}</Data></Cell>`).join("")}</Row>`;

                const sXml = [
                    '<?xml version="1.0"?>',
                    '<?mso-application progid="Excel.Sheet"?>',
                    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
                    '<Worksheet ss:Name="PaystreamMAP"><Table>',
                    fnRow(aColumns.map(c => c.label)),
                    ...aRows.map(oRow => fnRow(aColumns.map(c => oRow[c.key]))),
                    '</Table></Worksheet></Workbook>'
                ].join("");

                const sTs = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
                this._triggerDownload(sXml, `paystreammap_${sTs}.xls`, "application/vnd.ms-excel;charset=utf-8;");
            } catch (oError) {
                MessageBox.error(this._extractErrorMessage(oError));
            }
        },

        _triggerDownload(sContent, sFilename, sMimeType) {
            const oBlob = new Blob(["\ufeff" + sContent], { type: sMimeType });
            const sUrl = URL.createObjectURL(oBlob);
            const oLink = document.createElement("a");
            oLink.href = sUrl;
            oLink.download = sFilename;
            document.body.appendChild(oLink);
            oLink.click();
            document.body.removeChild(oLink);
            setTimeout(() => URL.revokeObjectURL(sUrl), 1000);
        },

        onFieldChange() {
            this._setPendingState();
        },

        // ── Value Help: Service Provider ──────────────────────────────────────
        onServiceProviderVHRequest(oEvent) {
            this._oVHSourceControl = oEvent.getSource();
            this._sVHTarget = this._oVHSourceControl.getBindingContext() ? "row" : "singleEdit";
            this._sVHField = "ServiceProvider";
            const oDialog = this.byId("spSelectDialog");
            oDialog.getBinding("items").filter([]);
            oDialog.open();
        },

        onSPVHSearch(oEvent) {
            const sQuery = oEvent.getParameter("value");
            const aFilters = sQuery ? [new sap.ui.model.Filter({
                filters: [
                    new sap.ui.model.Filter("service_provider", sap.ui.model.FilterOperator.Contains, sQuery),
                    new sap.ui.model.Filter("company_name", sap.ui.model.FilterOperator.Contains, sQuery)
                ], and: false
            })] : [];
            oEvent.getSource().getBinding("items").filter(aFilters);
        },

        onSPVHConfirm(oEvent) {
            const oItem = oEvent.getParameter("selectedItem");
            if (!oItem) { return; }
            this._applyVHValue("ServiceProvider", oItem.getTitle());
        },

        // ── Value Help: Zahlart1 ──────────────────────────────────────────────
        onZahlart1VHRequest(oEvent) {
            this._oVHSourceControl = oEvent.getSource();
            this._sVHTarget = this._oVHSourceControl.getBindingContext() ? "row" : "singleEdit";
            this._sVHField = "Zahlart1";
            const sSP = this._sVHTarget === "row"
                ? this._oVHSourceControl.getBindingContext().getProperty("ServiceProvider")
                : this.getView().getModel("ui").getProperty("/singleEdit/ServiceProvider");
            const oDialog = this.byId("zahlart1SelectDialog");
            const aFilters = sSP ? [new sap.ui.model.Filter("ServiceProvider", sap.ui.model.FilterOperator.EQ, sSP)] : [];
            oDialog.getBinding("items").filter(aFilters);
            oDialog.open();
        },

        onZahlart1VHSearch(oEvent) {
            const sQuery = oEvent.getParameter("value");
            const aFilters = [];
            const sSP = this._sVHTarget === "row"
                ? (this._oVHSourceControl && this._oVHSourceControl.getBindingContext() && this._oVHSourceControl.getBindingContext().getProperty("ServiceProvider"))
                : this.getView().getModel("ui").getProperty("/singleEdit/ServiceProvider");
            if (sSP) { aFilters.push(new sap.ui.model.Filter("ServiceProvider", sap.ui.model.FilterOperator.EQ, sSP)); }
            if (sQuery) {
                aFilters.push(new sap.ui.model.Filter({
                    filters: [
                        new sap.ui.model.Filter("Zahlart1", sap.ui.model.FilterOperator.Contains, sQuery),
                        new sap.ui.model.Filter("Text", sap.ui.model.FilterOperator.Contains, sQuery)
                    ], and: false
                }));
            }
            oEvent.getSource().getBinding("items").filter(aFilters);
        },

        onZahlart1VHConfirm(oEvent) {
            const oItem = oEvent.getParameter("selectedItem");
            if (!oItem) { return; }
            this._applyVHValue("Zahlart1", oItem.getTitle());
        },

        // ── Value Help: Ldgrp ─────────────────────────────────────────────────
        onLdgrpVHRequest(oEvent) {
            this._oVHSourceControl = oEvent.getSource();
            this._sVHTarget = this._oVHSourceControl.getBindingContext() ? "row" : "singleEdit";
            this._sVHField = "Ldgrp";
            const oDialog = this.byId("ldgrpSelectDialog");
            oDialog.getBinding("items").filter([]);
            oDialog.open();
        },

        onLdgrpVHSearch(oEvent) {
            const sQuery = oEvent.getParameter("value");
            const aFilters = sQuery ? [new sap.ui.model.Filter({
                filters: [
                    new sap.ui.model.Filter("LedgerGroup", sap.ui.model.FilterOperator.Contains, sQuery),
                    new sap.ui.model.Filter("LedgerGroupName", sap.ui.model.FilterOperator.Contains, sQuery)
                ], and: false
            })] : [];
            oEvent.getSource().getBinding("items").filter(aFilters);
        },

        onLdgrpVHConfirm(oEvent) {
            const oItem = oEvent.getParameter("selectedItem");
            if (!oItem) { return; }
            this._applyVHValue("Ldgrp", oItem.getTitle());
        },

        // ── Value Help: Ktart ─────────────────────────────────────────────────
        onKtartVHRequest(oEvent) {
            this._oVHSourceControl = oEvent.getSource();
            this._sVHTarget = this._oVHSourceControl.getBindingContext() ? "row" : "singleEdit";
            this._sVHField = "Ktart";
            const oDialog = this.byId("ktartSelectDialog");
            oDialog.getBinding("items").filter([]);
            oDialog.open();
        },

        onKtartVHSearch(oEvent) {
            const sQuery = oEvent.getParameter("value");
            const aFilters = sQuery ? [new sap.ui.model.Filter({
                filters: [
                    new sap.ui.model.Filter("DomainValue", sap.ui.model.FilterOperator.Contains, sQuery),
                    new sap.ui.model.Filter("DomainText", sap.ui.model.FilterOperator.Contains, sQuery)
                ], and: false
            })] : [];
            oEvent.getSource().getBinding("items").filter(aFilters);
        },

        onKtartVHConfirm(oEvent) {
            const oItem = oEvent.getParameter("selectedItem");
            if (!oItem) { return; }
            this._applyVHValue("Ktart", oItem.getTitle());
        },

        // ── Value Help: Shkzg ─────────────────────────────────────────────────
        onShkzgVHRequest(oEvent) {
            this._oVHSourceControl = oEvent.getSource();
            this._sVHTarget = this._oVHSourceControl.getBindingContext() ? "row" : "singleEdit";
            this._sVHField = "Shkzg";
            const oDialog = this.byId("shkzgSelectDialog");
            oDialog.getBinding("items").filter([]);
            oDialog.open();
        },

        onShkzgVHSearch(oEvent) {
            const sQuery = oEvent.getParameter("value");
            const aFilters = sQuery ? [new sap.ui.model.Filter({
                filters: [
                    new sap.ui.model.Filter("DomainValue", sap.ui.model.FilterOperator.Contains, sQuery),
                    new sap.ui.model.Filter("DomainText", sap.ui.model.FilterOperator.Contains, sQuery)
                ], and: false
            })] : [];
            oEvent.getSource().getBinding("items").filter(aFilters);
        },

        onShkzgVHConfirm(oEvent) {
            const oItem = oEvent.getParameter("selectedItem");
            if (!oItem) { return; }
            this._applyVHValue("Shkzg", oItem.getTitle());
        },

        // ── Value Help: Koart ─────────────────────────────────────────────────
        onKoartVHRequest(oEvent) {
            this._oVHSourceControl = oEvent.getSource();
            this._sVHTarget = this._oVHSourceControl.getBindingContext() ? "row" : "singleEdit";
            this._sVHField = "Koart";
            const oDialog = this.byId("koartSelectDialog");
            oDialog.getBinding("items").filter([]);
            oDialog.open();
        },

        onKoartVHSearch(oEvent) {
            const sQuery = oEvent.getParameter("value");
            const aFilters = sQuery ? [new sap.ui.model.Filter({
                filters: [
                    new sap.ui.model.Filter("DomainValue", sap.ui.model.FilterOperator.Contains, sQuery),
                    new sap.ui.model.Filter("DomainText", sap.ui.model.FilterOperator.Contains, sQuery)
                ], and: false
            })] : [];
            oEvent.getSource().getBinding("items").filter(aFilters);
        },

        onKoartVHConfirm(oEvent) {
            const oItem = oEvent.getParameter("selectedItem");
            if (!oItem) { return; }
            this._applyVHValue("Koart", oItem.getTitle());
        },

        // ── Value Help: Saknr (koart-sensitiv: S=GL, D=Debitor) ──────────────
        onSaknrVHRequest(oEvent) {
            this._oVHSourceControl = oEvent.getSource();
            this._sVHTarget = this._oVHSourceControl.getBindingContext() ? "row" : "singleEdit";
            this._sVHField = "Saknr";

            // Koart aus Zeilen-Kontext oder singleEdit lesen
            let sKoart = "";
            if (this._sVHTarget === "row") {
                const oCtx = this._oVHSourceControl.getBindingContext();
                sKoart = oCtx ? oCtx.getProperty("Koart") : "";
            } else {
                sKoart = this.getView().getModel("ui").getProperty("/singleEdit/Koart");
            }

            if (sKoart === "D") {
                const oDialog = this.byId("saknrDebSelectDialog");
                oDialog.getBinding("items").filter([]);
                oDialog.open();
            } else {
                const oDialog = this.byId("saknrGLSelectDialog");
                oDialog.getBinding("items").filter([]);
                oDialog.open();
            }
        },

        onSaknrGLVHSearch(oEvent) {
            const sQuery = oEvent.getParameter("value");
            const aFilters = sQuery ? [new sap.ui.model.Filter({
                filters: [
                    new sap.ui.model.Filter("GLAccount", sap.ui.model.FilterOperator.Contains, sQuery),
                    new sap.ui.model.Filter("GLAccountName", sap.ui.model.FilterOperator.Contains, sQuery)
                ], and: false
            })] : [];
            oEvent.getSource().getBinding("items").filter(aFilters);
        },

        onSaknrDebVHSearch(oEvent) {
            const sQuery = oEvent.getParameter("value");
            const aFilters = sQuery ? [new sap.ui.model.Filter({
                filters: [
                    new sap.ui.model.Filter("Customer", sap.ui.model.FilterOperator.Contains, sQuery),
                    new sap.ui.model.Filter("CustomerName", sap.ui.model.FilterOperator.Contains, sQuery)
                ], and: false
            })] : [];
            oEvent.getSource().getBinding("items").filter(aFilters);
        },

        onSaknrVHConfirm(oEvent) {
            const oItem = oEvent.getParameter("selectedItem");
            if (!oItem) { return; }
            this._applyVHValue("Saknr", oItem.getTitle());
        },

        onSaknrDebVHConfirm(oEvent) {
            const oItem = oEvent.getParameter("selectedItem");
            if (!oItem) { return; }
            this._applyVHValue("Saknr", oItem.getTitle());
        },

        // ── Value Help: Mwskz ─────────────────────────────────────────────────
        onMwskzVHRequest(oEvent) {
            this._oVHSourceControl = oEvent.getSource();
            this._sVHTarget = this._oVHSourceControl.getBindingContext() ? "row" : "singleEdit";
            this._sVHField = "Mwskz";
            const oDialog = this.byId("mwskzSelectDialog");
            oDialog.getBinding("items").filter([]);
            oDialog.open();
        },

        onMwskzVHSearch(oEvent) {
            const sQuery = oEvent.getParameter("value");
            const aFilters = sQuery ? [new sap.ui.model.Filter({
                filters: [
                    new sap.ui.model.Filter("TaxCode", sap.ui.model.FilterOperator.Contains, sQuery),
                    new sap.ui.model.Filter("TaxCodeName", sap.ui.model.FilterOperator.Contains, sQuery)
                ], and: false
            })] : [];
            oEvent.getSource().getBinding("items").filter(aFilters);
        },

        onMwskzVHConfirm(oEvent) {
            const oItem = oEvent.getParameter("selectedItem");
            if (!oItem) { return; }
            this._applyVHValue("Mwskz", oItem.getTitle());
        },

        // ── Value Help: Kostl ─────────────────────────────────────────────────
        onKostlVHRequest(oEvent) {
            this._oVHSourceControl = oEvent.getSource();
            this._sVHTarget = this._oVHSourceControl.getBindingContext() ? "row" : "singleEdit";
            this._sVHField = "Kostl";
            const oDialog = this.byId("kostlSelectDialog");
            oDialog.getBinding("items").filter([]);
            oDialog.open();
        },

        onKostlVHSearch(oEvent) {
            const sQuery = oEvent.getParameter("value");
            const aFilters = sQuery ? [new sap.ui.model.Filter({
                filters: [
                    new sap.ui.model.Filter("kostl", sap.ui.model.FilterOperator.Contains, sQuery),
                    new sap.ui.model.Filter("ktext", sap.ui.model.FilterOperator.Contains, sQuery)
                ], and: false
            })] : [];
            oEvent.getSource().getBinding("items").filter(aFilters);
        },

        onKostlVHConfirm(oEvent) {
            const oItem = oEvent.getParameter("selectedItem");
            if (!oItem) { return; }
            this._applyVHValue("Kostl", oItem.getTitle());
        },

        // ── Value Help: WbsElement ────────────────────────────────────────────
        onWbsVHRequest(oEvent) {
            this._oVHSourceControl = oEvent.getSource();
            this._sVHTarget = this._oVHSourceControl.getBindingContext() ? "row" : "singleEdit";
            this._sVHField = "WbsElement";
            const oDialog = this.byId("wbsSelectDialog");
            oDialog.getBinding("items").filter([]);
            oDialog.open();
        },

        onWbsVHSearch(oEvent) {
            const sQuery = oEvent.getParameter("value");
            const aFilters = sQuery ? [new sap.ui.model.Filter({
                filters: [
                    new sap.ui.model.Filter("posid", sap.ui.model.FilterOperator.Contains, sQuery),
                    new sap.ui.model.Filter("post1", sap.ui.model.FilterOperator.Contains, sQuery)
                ], and: false
            })] : [];
            oEvent.getSource().getBinding("items").filter(aFilters);
        },

        onWbsVHConfirm(oEvent) {
            const oItem = oEvent.getParameter("selectedItem");
            if (!oItem) { return; }
            this._applyVHValue("WbsElement", oItem.getTitle());
        },

        // ── Value Help: Blart ─────────────────────────────────────────────────
        onBlartVHRequest(oEvent) {
            this._oVHSourceControl = oEvent.getSource();
            this._sVHTarget = this._oVHSourceControl.getBindingContext() ? "row" : "singleEdit";
            this._sVHField = "Blart";
            const oDialog = this.byId("blartSelectDialog");
            oDialog.getBinding("items").filter([]);
            oDialog.open();
        },

        onBlartVHSearch(oEvent) {
            const sQuery = oEvent.getParameter("value");
            const aFilters = sQuery ? [new sap.ui.model.Filter({
                filters: [
                    new sap.ui.model.Filter("AccountingDocumentType", sap.ui.model.FilterOperator.Contains, sQuery),
                    new sap.ui.model.Filter("AccountingDocumentTypeName", sap.ui.model.FilterOperator.Contains, sQuery)
                ], and: false
            })] : [];
            oEvent.getSource().getBinding("items").filter(aFilters);
        },

        onBlartVHConfirm(oEvent) {
            const oItem = oEvent.getParameter("selectedItem");
            if (!oItem) { return; }
            this._applyVHValue("Blart", oItem.getTitle());
        },

        onVHCancel() { },

        // ── Helper: apply VH value to row context or singleEdit ───────────────
        _applyVHValue(sField, sValue) {
            if (this._sVHTarget === "singleEdit") {
                this.getView().getModel("ui").setProperty(`/singleEdit/${sField}`, sValue);
            } else {
                const oContext = this._oVHSourceControl && this._oVHSourceControl.getBindingContext();
                if (oContext) {
                    oContext.setProperty(sField, sValue);
                    this._setPendingState();
                }
            }
        },

        _setPendingState() {
            const bPending = this.getView().getModel().hasPendingChanges();
            this.getView().getModel("ui").setProperty("/hasPendingChanges", bPending);
        },

        async _activateDrafts() {
            const oModel = this.getView().getModel();
            const oListBinding = this.byId("mapTable").getBinding("items");
            const aTracked = (this._aCreatedContexts || []).filter(oCtx =>
                oCtx && !oCtx.isTransient() && oCtx.getProperty("IsActiveEntity") === false
            );
            const aVisibleDrafts = oListBinding.getCurrentContexts().filter(oCtx =>
                oCtx && !oCtx.isTransient() && oCtx.getProperty("IsActiveEntity") === false
            );
            const mByPath = Object.create(null);
            [...aTracked, ...aVisibleDrafts].forEach(oCtx => { mByPath[oCtx.getPath()] = oCtx; });
            const aDraftContexts = Object.keys(mByPath).map(p => mByPath[p]);

            if (aDraftContexts.length) {
                await Promise.all(aDraftContexts.map(oCtx => {
                    const oOperation = oModel.bindContext(
                        "com.sap.gateway.srvd.zui_rrpaystreammap_o4.v0001.Activate(...)",
                        oCtx,
                        { $$groupId: "$auto" }
                    );
                    return oOperation.execute("$auto");
                }));
            }
            this._aCreatedContexts = [];
            await new Promise(resolve => {
                oListBinding.attachEventOnce("dataReceived", resolve);
                oListBinding.refresh();
            });
        },

        _extractErrorMessage(oError) {
            if (!oError) { return this._getText("genericError"); }
            return oError.message || this._getText("genericError");
        },

        _getText(sKey, aArgs) {
            return this.getView().getModel("i18n").getResourceBundle().getText(sKey, aArgs);
        }
    });
});