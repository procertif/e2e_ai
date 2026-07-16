const { newId } = require("../../core/ids");

module.exports = function createGroupsService({ groupsRepo }) {
	function list() {
		return groupsRepo.list().map((g) => ({ id: g.id, name: g.name, tests: g.tests }));
	}

	function create(name) {
		return groupsRepo.save({ id: newId(), name, tests: [] });
	}

	function update(id, changes) {
		const group = list().find((g) => g.id === id);
		if (!group) return null;
		if (changes.name !== undefined) group.name = changes.name;
		if (changes.tests !== undefined) group.tests = changes.tests;
		return groupsRepo.save(group);
	}

	function remove(id) {
		const exists = list().some((g) => g.id === id);
		if (!exists) return false;
		groupsRepo.remove(id);
		return true;
	}

	// Called when a test is deleted, so no group keeps a dangling reference.
	function removeTestFromAllGroups(filename) {
		for (const group of list()) {
			if (group.tests.includes(filename)) {
				groupsRepo.save({ ...group, tests: group.tests.filter((t) => t !== filename) });
			}
		}
	}

	return { list, create, update, remove, removeTestFromAllGroups };
};
