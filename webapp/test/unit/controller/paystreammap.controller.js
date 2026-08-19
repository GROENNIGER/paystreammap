/*global QUnit*/

sap.ui.define([
	"rtl/paystreammap/paystreammap/controller/paystreammap.controller"
], function (Controller) {
	"use strict";

	QUnit.module("paystreammap Controller");

	QUnit.test("I should test the paystreammap controller", function (assert) {
		var oAppController = new Controller();
		oAppController.onInit();
		assert.ok(oAppController);
	});

});
